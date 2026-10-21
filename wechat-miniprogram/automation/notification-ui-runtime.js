// Rendering-only fixture injection. No business actions or native subscription request.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sdk = '../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection = require(sdk + 'Connection').default;
const MiniProgram = require(sdk + 'MiniProgram').default;
let auditStage = 'connect';
async function run() {
  const only = process.argv[2];
  if (only && !['booking-status', 'order-detail', 'provider-request', 'fulfillment'].includes(only)) throw Error('UNSUPPORTED_AUDIT_ROUTE');
  const mini = new MiniProgram(await Connection.create('ws://127.0.0.1:9423'));
  const out = path.resolve(__dirname, '../.artifacts/notification-ui-runtime', only || '.'); fs.mkdirSync(out, { recursive: true });
  const role = await mini.evaluate(() => wx.getStorageSync('animeMasterRole'));
  const checks = [];
  const screenshotErrors = [];
  try {
    assert.equal(await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.appId), 'wxc94e1c1b38944511');
    for (const [route, stage, viewerRole] of [['booking-status', 'REQUESTED', 'BUYER'], ['order-detail', 'IN_PRODUCTION', 'BUYER'],
      ['provider-request', 'REQUESTED', 'PROVIDER'], ['fulfillment', 'DELIVERY_PENDING', 'BUYER']]) {
      if (only && route !== only) continue;
      await mini.evaluate(value => wx.setStorageSync('animeMasterRole', value), viewerRole === 'BUYER' ? 'buyer' : 'provider');
      auditStage = route + ':navigate';
      const page = await mini.reLaunch(`/pages/${route}/index?id=notification-render-only`);
      for (let i = 0; i < 60; i++) {
        if (!(await page.data()).loading) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      assert.equal((await page.data()).loading, false);
      auditStage = route + ':render';
      await mini.evaluate(({ stage, viewerRole }) => {
        const p = getCurrentPages().slice(-1)[0];
        p.loadRequest = (p.loadRequest || 0) + 1;
        p.renderOrder({ id: 'ord_' + 'a'.repeat(32), cloudOrder: true, viewerRole, version: 1, stage,
          buyerId: 'acct_' + 'b'.repeat(32), providerId: 'acct_' + 'c'.repeat(32),
          buyer: '界面测试需求方', provider: '界面测试服务方', buyerUid: 'AM_TEST_BUYER', providerUid: 'AM_TEST_PROVIDER',
          career: '妆娘', service: '通知控件界面测试', city: '上海', time: '仅用于布局检查',
          finalPrice: 100, originalPrice: 100, paymentStatus: 'UNPAID', progress: 30,
          ndaRequired: false, serviceItems: [], events: [], deliveryFiles: [], deliveryNote: '仅用于布局检查',
          requirement: '测试数据，仅保存在当前页面内存，不会提交订单。', requestedAt: Date.now() });
        p.setData({ loading: false, loadError: '' });
      }, { stage, viewerRole });
      await new Promise(resolve => setTimeout(resolve, 500));
      auditStage = route + ':metrics';
      const metrics = await mini.evaluate(() => new Promise(resolve => {
        const p = getCurrentPages().slice(-1)[0], component = p.selectComponent('#order-subscription');
        if (!component) return resolve({ found: false, route: p.route, cloudOrder: p.data.order?.cloudOrder, stage: p.data.order?.stage });
        component.createSelectorQuery().select('.am-action').boundingClientRect()
          .select('.subscription-copy').fields({ computedStyle: ['color', 'font-size', 'line-height'], size: true })
          .exec(result => resolve({ found: true, button: result[0], copy: result[1], pending: component.data.pending }));
      }));
      if (!metrics.found) { console.log(JSON.stringify(metrics)); await mini.screenshot({ path: path.join(out, route + '-missing.png') }); }
      assert.equal(metrics.found, true); assert.ok(metrics.button.height >= 44); assert.equal(metrics.pending, false);
      if (route !== 'booking-status') {
        const heading = await mini.evaluate(() => new Promise(resolve => {
          const page = getCurrentPages().slice(-1)[0];
          page.createSelectorQuery().select('.order-fact-heading').boundingClientRect()
            .selectAll('.order-fact-heading-line').boundingClientRect().exec(resolve);
        }));
        const [box, lines] = heading;
        assert.ok(box && lines?.length === 2, route + ': heading and complete order identifier present');
        assert.ok(lines[1].top >= lines[0].bottom, route + ': identifier does not squeeze the heading');
        assert.ok(lines.every(line => line.left >= box.left - 1 && line.right <= box.right + 1), route + ': heading content stays inside card');
        metrics.heading = { box, lines };
      }
      auditStage = route + ':screenshots';
      try {
        await mini.screenshot({ path: path.join(out, route + '-top.png') });
        await mini.evaluate(() => wx.pageScrollTo({ scrollTop: 100000, duration: 0 }));
        await new Promise(resolve => setTimeout(resolve, 200));
        await mini.screenshot({ path: path.join(out, route + '-bottom.png') });
      } catch (_) { screenshotErrors.push(route); }
      checks.push({ route, viewerRole, ...metrics });
    }
    const report = { ok: screenshotErrors.length === 0, screenshotErrors, checkedAt: new Date().toISOString(), checks, fixtureOnly: true, businessWritesRequested: false,
      nativeAuthorizationRequested: false, scope: 'Current rendered top/bottom viewports and component styles only, not real orders, consent or complete scroll coverage.' };
    fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } finally {
    try { await mini.evaluate(value => value ? wx.setStorageSync('animeMasterRole', value) : wx.removeStorageSync('animeMasterRole'), role);
      await mini.reLaunch('/pages/discover/index'); } finally { mini.disconnect(); }
  }
}
run().catch(error => {
  const report = { ok: false, checkedAt: new Date().toISOString(), code: 'NOTIFICATION_UI_AUDIT_FAILED', stage: auditStage,
    error: String(error.message).slice(0, 400), fixtureOnly: true, businessWritesRequested: false };
  const route = ['booking-status', 'order-detail', 'provider-request', 'fulfillment'].includes(process.argv[2]) ? process.argv[2] : '.';
  const out = path.resolve(__dirname, '../.artifacts/notification-ui-runtime', route); fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report)); process.exitCode = 1;
});

