const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const Connection = require('miniprogram-automator/out/Connection').default;
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;
const out = path.resolve(__dirname, '../.artifacts/creator-applied-20260912');
// DevTools 2.02.2608040 omits Tool.getInfo.SDKVersion; use the same SDK transport without its obsolete version comparison.
async function main() {
  await new Promise(resolve => setTimeout(resolve, 3000));
  fs.mkdirSync(out, { recursive: true });
  const connection = await Connection.create('ws://127.0.0.1:9422');
  const app = new MiniProgram(connection);
  const checks = [], errors = [], shots = [];
  const savedKeys = ['animeMasterRole','animeMasterCreatorAuditDraft','anime-master-v063-profile','anime-master-v063-services','anime-master-v063-works','anime-master-v063-pins','anime-master-v063-notice-image'];
  const original = new Map();
  app.on('exception', e => errors.push(e));
  async function shot(name) { await new Promise(r => setTimeout(r, 700)); shots.push({ name, data: await app.screenshot() }); console.log('captured', name); }
  async function ends(name) { await shot(name); await app.pageScrollTo(100000); await shot(`${name}-bottom`); await app.pageScrollTo(0); }
  try {
    const info = await app.callWxMethod('getStorageInfoSync');
    for (const key of savedKeys) original.set(key, { present: info.keys.includes(key), value: await app.callWxMethod('getStorageSync', key) });
    console.log(await connection.send('Tool.getInfo'));
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'provider');
    let page = await app.reLaunch('/pages/provider-profile/index?audit=1');
    await page.waitFor(1000);
    console.log('editor', await page.data('navTitle'), await page.data('creator'));
    const menuStyles = await app.evaluate(() => new Promise(resolve => wx.createSelectorQuery().selectAll('.creator-work-menu').fields({ computedStyle: ['width', 'height', 'max-width'] }, resolve).exec()));
    assert(menuStyles.length); for (const style of menuStyles) { assert.equal(parseFloat(style.width), 44); assert(parseFloat(style.height) >= 44); } checks.push('作品菜单实际44px热区与宽度');
    await ends('manage-top');
    if (process.argv.includes('--capture-only')) return;
    await (await page.$('[data-section="profile"]')).tap();
    await ends('profile-editor');
    const originalBio = await page.data('profileDraft.bio');
    await page.callMethod('updateProfile', { currentTarget: { dataset: { key: 'bio' } }, detail: { value: '未保存的运行时检查' } });
    await page.callMethod('cancelSection');
    assert.equal(await page.data('profileDraft.bio'), originalBio); checks.push('资料取消恢复');
    await (await page.$('[data-tab="services"]')).tap(); await ends('manage-services');
    const service = (await page.data('serviceDrafts'))[0];
    await page.callMethod('toggleServiceEditor', { currentTarget: { dataset: { id: service.id } } }); await ends('service-editor');
    await page.callMethod('openWorkPicker', { currentTarget: { dataset: { index: 0 } } }); await shot('work-picker');
    await page.callMethod('closeWorkPicker'); await page.callMethod('cancelSection');
    await page.callMethod('openSection', { currentTarget: { dataset: { section: 'notice' } } }); await shot('notice-editor');
    await page.callMethod('cancelSection');
    await page.callMethod('openSection', { currentTarget: { dataset: { section: 'profile' } } });
    await page.callMethod('updateProfile', { currentTarget: { dataset: { key: 'specialties' } }, detail: { value: '本地回归验证保存字段' } });
    await page.callMethod('saveSection');
    page = await app.reLaunch('/pages/provider-profile/index?audit=1'); await page.waitFor(700);
    assert.equal(await page.data('profileDraft.specialties'), '本地回归验证保存字段'); checks.push('保存后页面重建恢复');
    await page.callMethod('previewSaved'); await new Promise(r => setTimeout(r, 2200));
    let preview = await app.currentPage(); assert.equal(preview.path, 'pages/provider-detail/index');
    assert.equal(await preview.data('visitorDraftPreview'), true); await ends('saved-visitor-preview');
    await app.callWxMethod('navigateBack', { delta: 1 }); await new Promise(r => setTimeout(r, 1000)); page = await app.currentPage();
    await page.callMethod('saveAndPreview'); await new Promise(r => setTimeout(r, 2200)); preview = await app.currentPage();
    await shot('publish-preview'); await preview.callMethod('confirmPublish');
    assert.equal(await preview.data('previewPublished'), true); checks.push('本地草稿与确认发布分离');
    await app.reLaunch('/pages/provider-profile/index?audit=1&section=works&workId=w-mu-1'); await ends('work-editor');
    await app.callWxMethod('setStorageSync', 'animeMasterRole', 'buyer');
    page = await app.reLaunch('/pages/provider-detail/index?id=1&audit=1'); await page.waitFor(800); await shot('visitor-works');
    await (await page.$('[data-tab="services"]')).tap(); await ends('visitor-services');
    await app.pageScrollTo(450); await new Promise(r => setTimeout(r, 500));
    await (await page.$('.creator-service .creator-link')).tap();
    await new Promise(r => setTimeout(r, 600));
    assert.equal((await page.data('provider.services'))[0].expanded, true); await ends('visitor-service-expanded'); checks.push('服务说明原生点击展开');
    const services = await page.data('provider.services');
    const available = services.find(service => service.availableInCity !== false);
    console.log('services availability', services.map(s => [s.id, s.availableInCity]));
    assert(available, '当前检索城市需有可预约服务');
    await page.callMethod('toggleService', { currentTarget: { dataset: { id: available.id } } });
    const selected = await page.data('selectedServiceIds'); const total = await page.data('selectedTotal'); assert.equal(selected.length, 1);
    await (await page.$('[data-tab="schedule"]')).tap(); await shot('visitor-schedule');
    assert.deepEqual(await page.data('selectedServiceIds'), selected); assert.equal(await page.data('selectedTotal'), total); checks.push('跨分页保留选择与合计');
    await page.callMethod('openNotice'); await shot('visitor-notice'); await page.callMethod('closeNotice');
    await page.callMethod('openReviews'); await shot('visitor-reviews'); await page.callMethod('closeReviews');
    await page.callMethod('startBooking'); await new Promise(r => setTimeout(r, 2200));
    const next = await app.currentPage(); assert.equal(next.path, 'pages/booking/index'); await shot('booking-next'); checks.push('所选服务进入原确认预约');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    for (const [key, saved] of original) {
      if (saved.present) await app.callWxMethod('setStorageSync', key, saved.value);
      else await app.callWxMethod('removeStorageSync', key);
    }
    app.disconnect();
    for (const shot of shots) fs.writeFileSync(path.join(out, `${shot.name}.png`), shot.data, 'base64');
    fs.writeFileSync(path.join(out, 'runtime.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors, boundary: '当前开发者工具本地预览；无云端发布、无真机验收' }, null, 2));
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
