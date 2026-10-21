// Native navigation with in-memory fixtures; no save, booking or payment action.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
const out = path.resolve(__dirname, '../.artifacts/work-owner-runtime');
fs.mkdirSync(out, { recursive: true });
async function run() {
  const mini = new MiniProgram(await Connection.create('ws://127.0.0.1:9423'));
  const report = { ok: false, checkedAt: new Date().toISOString(), fixtureOnly: true, businessWritesRequested: false, checks: [] };
  async function waitRoute(route) {
    for (let i = 0; i < 150; i++) {
      if (await mini.evaluate(() => getCurrentPages().slice(-1)[0].route) === route) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('ROUTE_NOT_READY:' + route);
  }
  try {
    assert.equal(await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId), 'wxc94e1c1b38944511');
    for (const workspace of ['buyer', 'provider']) {
      await mini.reLaunch('/pages/provider-detail/index?id=ownership_runtime_missing&workspace=' + workspace);
      await waitRoute('pages/provider-detail/index');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await mini.evaluate(workspace => {
        const p = getCurrentPages().slice(-1)[0];
        if (!Number.isInteger(p.providerRequestId)) throw Error('CURRENT_PROVIDER_CODE_NOT_LOADED');
        p.providerRequestId++; p.socialRequestId = (p.socialRequestId || 0) + 1;
        p.providerPreview = workspace === 'provider';
        p.setData({ provider: { id: 'ownership_fixture_author', services: [], works: [] } });
        p.openWork({ detail: { id: 'ownership_fixture_work' } });
      }, workspace);
      let state;
      for (let i = 0; i < 150; i++) {
        state = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, options: p.options, currentCode: Number.isInteger(p.workRequestId) }; });
        if (state.route === 'pages/work-detail/index') break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(state.route, 'pages/work-detail/index');
      assert.equal(state.options.providerId, 'ownership_fixture_author');
      assert.equal(state.currentCode, true);
      assert.equal(state.options.workspace || 'buyer', workspace);
      // Match automator.changeRoute's settling interval before another navigation.
      await new Promise(resolve => setTimeout(resolve, 3000));
      await mini.evaluate(() => {
        const p = getCurrentPages().slice(-1)[0]; p.workRequestId++;
        p.renderWork({ id: 'ownership_fixture_work', code: 'AM-FIXTURE', title: '作者归属运行检查', description: '仅当前页面内存中的测试作品，不会提交到云端。', price: 100, imageCount: 0, imagePreviews: [], tags: [], provider: { id: 'ownership_fixture_author', name: '界面测试作者', career: '摄影', city: '上海' } }, p.options, { providerIds: [], workIds: [] });
      });
      await new Promise(resolve => setTimeout(resolve, 300));
      await mini.screenshot({ path: path.join(out, 'work-' + workspace + '.png') });
      report.beforeBack = await mini.evaluate(() => getCurrentPages().map(p => p.route));
      report.backResult = await mini.evaluate(() => new Promise(resolve => wx.navigateBack({ delta: 1, success: result => resolve(result.errMsg), fail: result => resolve(result.errMsg) })));
      for (let i = 0; i < 40 && await mini.evaluate(() => getCurrentPages().slice(-1)[0].route) !== 'pages/provider-detail/index'; i++) await new Promise(resolve => setTimeout(resolve, 100));
      report.afterBack = await mini.evaluate(() => getCurrentPages().map(p => p.route));
      report.checks.push({ entry: 'provider-detail', workspace, ownerForwarded: true, returned: report.afterBack[report.afterBack.length - 1] === 'pages/provider-detail/index' });
    }
    await mini.reLaunch('/pages/me-assets/index?type=liked');
    await waitRoute('pages/me-assets/index');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await mini.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      if (!Number.isInteger(p.assetsRequestId)) throw Error('CURRENT_ASSETS_CODE_NOT_LOADED');
      p.assetsRequestId++;
      p.setData({ loading: false, loadError: '', items: [{ id: 'ownership_fixture_work', providerId: 'ownership_fixture_author', kind: 'work', title: '归属测试作品', subtitle: '仅界面内存', meta: 'AM-FIXTURE' }] });
      p.openItem({ currentTarget: { dataset: { id: 'ownership_fixture_work', kind: 'work' } } });
    });
    for (let i = 0; i < 40 && await mini.evaluate(() => getCurrentPages().slice(-1)[0].route) !== 'pages/work-detail/index'; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await mini.evaluate(() => getCurrentPages().slice(-1)[0].options.providerId), 'ownership_fixture_author');
    await new Promise(resolve => setTimeout(resolve, 3000));
    await mini.evaluate(() => new Promise(resolve => wx.navigateBack({ delta: 1, complete: resolve })));
    for (let i = 0; i < 40 && await mini.evaluate(() => getCurrentPages().slice(-1)[0].route) !== 'pages/me-assets/index'; i++) await new Promise(resolve => setTimeout(resolve, 100));
    report.checks.push({ entry: 'me-assets', ownerForwarded: true, returned: await mini.evaluate(() => getCurrentPages().slice(-1)[0].route) === 'pages/me-assets/index' });
    for (const index of [0, 1]) {
      await mini.reLaunch('/pages/me-assets/index?type=referenced');
      await waitRoute('pages/me-assets/index');
      await new Promise(resolve => setTimeout(resolve, 3000));
      const page = await mini.currentPage();
      await mini.evaluate(() => {
        const p = getCurrentPages().slice(-1)[0]; p.assetsRequestId++;
      });
      // App.callFunction's page proxy can change logic data without updating the view.
      // Page.setData uses the automator's page bridge; verify rendered rows before tapping.
      await page.setData({ loading: false, loadError: '', items: ['one', 'two'].map(owner => ({
        key: 'work:' + owner + ':shared', id: 'shared', providerId: owner, kind: 'work',
        title: owner === 'one' ? '作者甲的参考作品' : '作者乙的参考作品', subtitle: '仅页面内存测试', meta: 'AM-FIXTURE'
      })) });
      for (let i = 0; i < 50 && (await page.$$('.asset-rows button')).length !== 2; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (index === 0) await mini.screenshot({ path: path.join(out, 'referenced-collision.png') });
      report.referenceState = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return { route: p.route, count: p.data.items.length, loading: p.data.loading, loadError: p.data.loadError }; });
      const buttons = await page.$$('.asset-rows button');
      assert.equal(buttons.length, 2);
      assert.match(await buttons[0].text(), /作者甲的参考作品/);
      assert.match(await buttons[1].text(), /作者乙的参考作品/);
      await buttons[index].tap();
      await waitRoute('pages/work-detail/index');
      await new Promise(resolve => setTimeout(resolve, 3000));
      assert.equal(await mini.evaluate(() => getCurrentPages().slice(-1)[0].options.providerId), ['one', 'two'][index]);
      await mini.navigateBack();
      await waitRoute('pages/me-assets/index');
      report.checks.push({ entry: 'referenced-native-button', owner: ['one', 'two'][index], ownerForwarded: true,
        returned: await mini.evaluate(() => getCurrentPages().slice(-1)[0].route) === 'pages/me-assets/index' });
    }
    report.ok = report.checks.every(check => check.returned);
    if (!report.ok) process.exitCode = 1;
  } catch (error) { report.error = String(error.message).slice(0, 300); process.exitCode = 1; }
  finally {
    fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    try { await mini.reLaunch('/pages/discover/index'); await waitRoute('pages/discover/index'); } finally { mini.disconnect(); }
  }
}
run().catch(error => { console.error(String(error.message)); process.exitCode = 1; });
