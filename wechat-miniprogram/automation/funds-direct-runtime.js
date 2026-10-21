const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Connection = require('miniprogram-automator/out/Connection').default;
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const compare = require('licia/cmpVersion');

async function main() {
  // IDE 2.02.2608040 Tool.getInfo omits SDKVersion. Verify actual runtime SDK instead.
  const mini = new MiniProgram(await Connection.create(process.env.WECHAT_AUTO_WS || 'ws://127.0.0.1:9422'));
  const folder = path.resolve(__dirname, '../.artifacts/company-direct-payment-runtime');
  fs.mkdirSync(folder, { recursive: true });
  const errors = [];
  mini.on('exception', e => errors.push(String(e)));
  try {
    const system = await mini.callWxMethod('getSystemInfoSync');
    console.log('Runtime SDK obtained');
    assert.ok(system.SDKVersion && compare(system.SDKVersion, '2.7.3') >= 0);
    const page = await mini.reLaunch('/pages/funds/index?audit=1');
    console.log('Funds route opened');
    await page.waitFor(600);
    assert.equal(page.path, 'pages/funds/index');
    assert.equal(await page.data('loaded'), true);
    await mini.screenshot({ path: path.join(folder, 'empty.png') });
    console.log('Empty screenshot saved');
    // Explicit UI fixtures only, not a cloud receipt or evidence of actual paid money.
    await mini.evaluate(response => { getCurrentPages().slice(-1)[0].renderResponse(response, false); return true; }, { records: [
      { id: 'a'.repeat(32), orderId: 'ORDER-20260925-0001', status: 'PAID', totalFen: 10000,
        platformFeeFen: 2000, expectedIncomeFen: 8000, currency: 'CNY', paidAt: 1790265600000 },
      { id: 'b'.repeat(32), orderId: 'ORDER-20260925-0002', status: 'PAID_REQUIRES_REVIEW', totalFen: 88000,
        platformFeeFen: 17600, expectedIncomeFen: null, currency: 'CNY', paidAt: 1790265600000 }
    ], nextCursor: null, merchantStatus: 'NOT_STARTED' });
    await page.waitFor(300);
    console.log('Receipt fixture rendered');
    // Synchronize automator's view state after injecting a fixture through the App service.
    await page.setData(await page.data());
    const records = await page.data('records');
    assert.equal(records[0].incomeText, '￥80.00');
    assert.equal(records[1].incomeText, '待核对');
    const row = await page.$('.record-row');
    console.log(JSON.stringify({ rowWidth: await row.style('width'), padding: await row.style('padding-left'), margin: await row.style('margin-left') }));
    await mini.screenshot({ path: path.join(folder, 'records.png') });
    const guide = await page.$('.secondary-block');
    assert.ok(guide); await guide.tap(); await page.waitFor(300);
    await mini.screenshot({ path: path.join(folder, 'guide.png') });
    await mini.native().confirmModal();
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(folder, 'runtime.json'), JSON.stringify({ checkedAt: new Date().toISOString(),
      SDKVersion: system.SDKVersion, fixtureOnly: true, realPayment: false, screenshots: ['empty.png', 'records.png', 'guide.png'], errors }, null, 2));
    console.log('Funds runtime: empty, receipt/review fixtures and native guide passed; no real payment.');
  } finally { mini.disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
