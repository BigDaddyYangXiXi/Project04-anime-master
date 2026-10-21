const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const Connection = require('miniprogram-automator/out/Connection').default;
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const store = require('../miniprogram/data/v063-store');
async function main() {
  const app = new MiniProgram(await Connection.create('ws://127.0.0.1:9422'));
  const keys = [store.KEYS.orders, 'animeMasterRole'];
  const info = await app.callWxMethod('getStorageInfoSync');
  const saved = await Promise.all(keys.map(key => app.callWxMethod('getStorageSync', key)));
  const shots = [];
  const fixture = { ...structuredClone(store.initialOrders[0]), id: 'nda-runtime', stage: 'REQUESTED',
    ndaRequired: true, ndaFlowVersion: 2, buyerNdaSigned: false, providerNdaSigned: false, communicationDone: false,
    requirement: '运行时保密正文，仅双方签署后可见', referenceImage: '', executable: false };
  try {
    await app.callWxMethod('setStorageSync', store.KEYS.orders, [fixture]);
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'buyer');
    let page = await app.reLaunch('/pages/booking/index?providerId=1&audit=1&fixture=valid'); await page.waitFor(800);
    await app.pageScrollTo(700); await page.waitFor(300);
    await (await page.$('switch')).tap(); await page.waitFor(300);
    assert.equal(await page.data('ndaRequired'), true);
    shots.push(['booking-nda', await app.screenshot()]);
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'provider');
    page = await app.reLaunch('/pages/provider-request/index?id=nda-runtime&audit=1'); await page.waitFor(600);
    assert.equal(await page.data('order.requirement'), '');
    shots.push(['provider-hidden', await app.screenshot()]);
    await page.callMethod('interested'); await page.waitFor(300);
    assert.equal(await page.data('order.stage'), 'NDA_BUYER_PENDING');
    await app.mockWxMethod('showModal', { confirm: true, cancel: false });
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'buyer');
    page = await app.reLaunch('/pages/booking-status/index?id=nda-runtime&audit=1'); await page.waitFor(600);
    assert.equal(await page.data('canSignNda'), true);
    shots.push(['buyer-sign', await app.screenshot()]);
    await page.callMethod('signNda'); await page.waitFor(300);
    assert.equal(await page.data('order.stage'), 'NDA_PROVIDER_PENDING');
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'provider');
    page = await app.reLaunch('/pages/provider-task/index?id=nda-runtime&audit=1'); await page.waitFor(600);
    assert.equal(await page.data('canSign'), true);
    await page.callMethod('sign'); await page.waitFor(300);
    assert.equal(await page.data('order.stage'), 'CONTACTING');
    shots.push(['provider-signed', await app.screenshot()]);
    await (await page.$('.primary-block')).tap();
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      page = await app.currentPage();
      if (page.path === 'pages/provider-request/index') break;
    }
    assert.equal(page.path, 'pages/provider-request/index');
    await page.waitFor(1200);
    assert.equal(await page.data('order.requirement'), fixture.requirement);
    assert.equal(await page.data('order.communicationDone'), false);
    shots.push(['provider-revealed', await app.screenshot()]);
  } finally {
    await app.restoreWxMethod('showModal');
    for (let i = 0; i < keys.length; i++) {
      if (info.keys.includes(keys[i])) await app.callWxMethod('setStorageSync', keys[i], saved[i]);
      else await app.callWxMethod('removeStorageSync', keys[i]);
    }
    await app.reLaunch('/pages/discover/index?audit=1');
    await app.disconnect();
    const folder = path.join(__dirname, '../.artifacts/nda-flow'); fs.mkdirSync(folder, { recursive: true });
    for (const [name, data] of shots) fs.writeFileSync(path.join(folder, `${name}.png`), Buffer.from(data, 'base64'));
  }
  console.log('Native preview: NDA toggle, hidden fields, buyer/provider signing and unlocked communication passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
