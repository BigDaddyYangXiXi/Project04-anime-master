const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const Connection = require('miniprogram-automator/out/Connection').default;
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const out = path.resolve(__dirname, '../.artifacts/creator-hierarchy-20260912');
async function main() {
  await new Promise(r => setTimeout(r, 3000));
  const app = new MiniProgram(await Connection.create('ws://127.0.0.1:9422'));
  const shots = [], checks = [], errors = [], saved = [];
  app.on('exception', e => errors.push(e));
  async function shot(name) { await new Promise(r => setTimeout(r, 700)); shots.push([name, await app.screenshot()]); }
  async function page(route) { const p = await app.reLaunch(route); await p.waitFor(1000); return p; }
  async function followStyle() { return app.evaluate(() => new Promise(resolve => wx.createSelectorQuery().select('.follow-button').fields({ rect: true, computedStyle: ['width','height','border-radius','color','background-color','font-size','border-color'] }, resolve).exec())); }
  try {
    const info = await app.callWxMethod('getStorageInfoSync');
    for (const key of ['animeMasterRole', 'v063-followed-providers']) saved.push({ key, present: info.keys.includes(key), value: await app.callWxMethod('getStorageSync', key) });
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'buyer');
    await app.callWxMethod('setStorageSync', 'v063-followed-providers', []);
    let p = await page('/pages/provider-detail/index?id=1&audit=1');
    const profileStyle = await followStyle(); assert(profileStyle);
    const person = await (await p.$('.creator-person')).offset();
    assert(profileStyle.top >= person.top && profileStyle.top < person.top + 100, '关注位于身份行');
    await shot('visitor-top'); await app.pageScrollTo(100000); await shot('visitor-bottom'); await app.pageScrollTo(0);
    await (await p.$('.follow-button')).tap(); await p.waitFor(600); assert.equal(await p.data('followed'), true);
    const activeStyle = await followStyle(); await shot('visitor-followed');
    await (await p.$('.creator-cooperation .creator-link')).tap(); await p.waitFor(600); assert.equal(await p.data('preferencesOpen'), true); await shot('cooperation-expanded');
    await p.callMethod('chooseProfileTab', { currentTarget: { dataset: { tab: 'services' } } }); await app.pageScrollTo(400); await shot('services');
    p = await page('/pages/work-detail/index?id=w-mu-1&audit=1');
    assert.equal(await p.data('followed'), true, '跨页恢复同一关注关系');
    const workActive = await followStyle();
    for (const key of ['width','height','border-radius','color','background-color','font-size','border-color']) assert.equal(activeStyle[key], workActive[key], key);
    await shot('work-followed');
    await (await p.$('.follow-button')).tap(); await p.waitFor(600); assert.equal(await p.data('followed'), false);
    const workStyle = await followStyle();
    for (const key of ['width','height','border-radius','color','background-color','font-size','border-color']) assert.equal(profileStyle[key], workStyle[key], key);
    await shot('work-unfollowed'); checks.push('两页关注位于身份行右侧，未关注及已关注实际样式一致');
    p = await page('/pages/provider-detail/index?id=1&audit=1'); assert.equal(await p.data('followed'), false); checks.push('主页关注、作品页取消及页面重建同步');
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'provider');
    p = await page('/pages/provider-profile/index?audit=1'); assert.equal(await p.$('.follow-button'), null); await shot('manage-top'); await app.pageScrollTo(100000); await shot('manage-bottom'); checks.push('管理页共用信息层级，本人不显示关注');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    for (const s of saved) { if (s.present) await app.callWxMethod('setStorageSync', s.key, s.value); else await app.callWxMethod('removeStorageSync', s.key); }
    app.disconnect(); fs.mkdirSync(out, { recursive: true });
    for (const [name, data] of shots) fs.writeFileSync(path.join(out, name + '.png'), data, 'base64');
    fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors, boundary: '本地开发者工具，未部署，非真机验收' }, null, 2));
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
