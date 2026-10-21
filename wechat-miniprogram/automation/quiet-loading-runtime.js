// Real account reads only. No profile/city saves, booking or money mutations.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default, MiniProgram = require(sdk + 'MiniProgram').default;
const out = path.resolve(__dirname, '../.artifacts/quiet-loading-runtime');
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const mini = new MiniProgram(await Connection.create('ws://127.0.0.1:9423'));
  const report = { checkedAt: new Date().toISOString(), ok: false, businessWritesRequested: false, checks: [] };
  async function settled(page, field) {
    for (let i = 0; i < 150; i++) { if (!(await page.data())[field]) return; await sleep(200); }
    throw Error('PAGE_TIMEOUT:' + field);
  }
  try {
    const originalRole = await mini.callWxMethod('getStorageSync', 'animeMasterRole');
    report.originalRole = originalRole;
    await mini.evaluate(() => {
      if (wx.getAccountInfoSync().miniProgram.appId !== 'wxc94e1c1b38944511') throw Error('APP_ID_MISMATCH');
      getApp().__quietSession = { done: false };
      wx.cloud.callFunction({ name: 'account-bootstrap', data: { action: 'getSession' } }).then(({ result }) => {
        if (result?.ok && result.data.registered) {
          getApp().setServerSession(result.data); getApp().__quietSession = { done: true, ok: true };
        } else getApp().__quietSession = { done: true, ok: false };
      }).catch(() => { getApp().__quietSession = { done: true, ok: false }; });
    });
    let session;
    for (let i = 0; i < 100; i++) { session = await mini.evaluate(() => getApp().__quietSession); if (session.done) break; await sleep(200); }
    assert.equal(session.ok, true);
    await mini.callWxMethod('setStorageSync', 'animeMasterRole', 'buyer');
    let page = await mini.reLaunch('/pages/discover/index');
    await settled(page, 'catalogLoading');
    let data = await page.data();
    const today = await mini.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
    assert.equal(data.date, today);
    assert.doesNotMatch(data.locationMessage, /正在|读取/);
    const savedCity = data.cityCode;
    await mini.screenshot({ path: path.join(out, 'buyer-discovery.png') });
    await page.setData({ city: '', cityCode: '', locationLabel: '' });
    const cityStart = Date.now(); await page.callMethod('onLoad', {}); data = await page.data();
    assert.equal(data.cityCode, savedCity);
    report.checks.push({ name: 'today-and-city-page-rebuild', passed: true, date: data.date, hasConfirmedCity: Boolean(savedCity), synchronousInitObservedMs: Date.now() - cityStart });
    page = await mini.switchTab('/pages/me/index'); await settled(page, 'dashboardLoading');
    data = await page.data(); assert.equal(data.dashboardError, ''); assert.ok(data.account.nickname);
    await mini.screenshot({ path: path.join(out, 'buyer-me.png') });
    await page.setData({ account: null });
    const profileStart = Date.now(); const refresh = page.callMethod('loadCloudDashboard', 'buyer');
    await sleep(100); data = await page.data();
    assert.ok(data.account.nickname);
    report.checks.push({ name: 'identity-visible-before-statistics', passed: true, observedMs: Date.now() - profileStart, statisticsStillPending: data.dashboardLoading });
    await refresh; await settled(page, 'dashboardLoading');
    await page.callMethod('switchIdentity'); await sleep(3200);
    page = await mini.currentPage(); assert.equal(page.path, 'pages/discover/index');
    await settled(page, 'dashboardLoading'); data = await page.data(); assert.equal(data.dashboardError, ''); assert.equal(data.role, 'provider');
    assert.ok(data.profile.nickname); assert.doesNotMatch(data.providerVisibilityText, /正在|读取/);
    await mini.screenshot({ path: path.join(out, 'provider-workbench.png') });
    page = await mini.switchTab('/pages/me/index'); await settled(page, 'dashboardLoading');
    assert.equal((await page.data()).dashboardError, '');
    await mini.screenshot({ path: path.join(out, 'provider-me.png') });
    report.checks.push({ name: 'provider-workbench-and-me', passed: true });
    report.ok = true;
  } catch (error) { report.error = String(error.message).slice(0, 250); process.exitCode = 1; }
  finally {
    fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    try { await mini.callWxMethod('setStorageSync', 'animeMasterRole', report.originalRole || 'buyer'); await mini.reLaunch('/pages/discover/index'); } finally { mini.disconnect(); }
  }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
