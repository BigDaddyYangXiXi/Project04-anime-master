// Native audit fixtures do not call order/payment services; restoring login reads the session.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const output = path.resolve(__dirname, '../.artifacts/order-refresh-native');
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || 'ws://127.0.0.1:9422' });
  const evidence = { kind: 'explicit audit fixtures, no account/payment writes', cases: [] };
  try {
    evidence.version = await mini.evaluate(() => getApp().globalData.version);
    const device = await mini.systemInfo();
    evidence.device = { platform: device.platform, sdk: device.SDKVersion, width: device.windowWidth, height: device.windowHeight };
    await mini.reLaunch('/pages/auth/index?audit=1&state=login');
    for (const route of ['booking-status', 'order-detail', 'provider-request']) {
      const page = await mini.navigateTo(`/pages/${route}/index?id=AM-260816-01&audit=1`);
      assert.equal(page.path, `pages/${route}/index`);
      const fixture = await page.data('order');
      assert.ok(fixture && fixture.id, 'audit order must be available');
      let version = 6;
      for (const state of ['PAID', 'PAYMENT_REVIEW']) {
        const current = { ...fixture, cloudOrder: true, version: version++, stage: 'BUYER_FINAL_CONFIRM',
          paymentStatus: state, communicationDone: true, timePlaceConfirmed: true, serviceScopeConfirmed: true,
          amountConfirmed: true, executable: true, ndaRequired: false, buyerAgreementConfirmedAt: 1000 };
        await page.callMethod('renderOrder', current);
        await page.callMethod('renderOrder', { ...current, version: current.version - 1, paymentStatus: 'UNPAID' });
        await page.waitFor(200);
        const actual = await page.data('order');
        assert.equal(actual.version, current.version);
        assert.equal(actual.paymentStatus, state);
        await mini.pageScrollTo(0); await page.waitFor(150);
        await mini.screenshot({ path: path.join(output, `${route}-${state}-top.png`) });
        await mini.pageScrollTo(100000); await page.waitFor(150);
        await mini.screenshot({ path: path.join(output, `${route}-${state}-bottom.png`) });
        evidence.cases.push({ route, state, version: actual.version, olderResultRejected: true });
      }
      await mini.navigateBack();
    }
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Native order refresh render checks passed: ${evidence.cases.length}`);
  } finally {
    // Restore the real login entrance; this performs its normal read-only session check.
    await mini.reLaunch('/pages/auth/index').catch(() => {});
    mini.disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
