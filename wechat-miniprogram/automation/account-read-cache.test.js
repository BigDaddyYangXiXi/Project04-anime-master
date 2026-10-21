const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../miniprogram/services/cloud-account'), 'utf8');
function harness(clock = Date) {
  const app = { globalData: { account: { id: 'one', nickname: '已登录昵称' } } };
  const storage = new Map(), calls = [];
  const wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), cloud: {
    callFunction: ({ data }) => new Promise(resolve => calls.push({ data, resolve: value => resolve({ result: { ok: true, data: value } }) }))
  } };
  const context = { module: { exports: {} }, getApp: () => app, wx, Date: clock, require: name => name === "../utils/display-cache" ? require("../miniprogram/utils/display-cache") : name === "../utils/cloud-call" ? require("../miniprogram/utils/cloud-call") : name.includes('local-preview') ? { assertCloudAllowed() {} } : { enabled: true, env: 'test' } };
  vm.runInNewContext(source, context);
  return { api: context.module.exports, app, storage, calls, wx, reload() {
    const fresh = { ...context, module: { exports: {} } }; vm.runInNewContext(source, fresh); return fresh.module.exports;
  } };
}
test('profile is visible from verified session while concurrent reads share one request', async () => {
  const { api, calls } = harness();
  assert.equal(api.peekMine().nickname, '已登录昵称');
  const a = api.getMine(), b = api.getMine();
  assert.equal(calls.length, 1);
  calls[0].resolve({ id: 'one', nickname: '云端昵称' });
  await Promise.all([a, b]);
  assert.equal((await api.getMine()).nickname, '云端昵称');
  assert.equal(calls.length, 1);
});

test('page switches reuse the avatar across profile refreshes; changes, expiry and logout resolve anew', async () => {
  let now = 1000, urls = 0;
  const { api, calls, wx } = harness({ now: () => now });
  wx.cloud.getTempFileURL = async () => ({ fileList: [{ tempFileURL: 'https://example.test/avatar-' + ++urls }] });
  const profile = { id: 'one', nickname: 'name', avatarFileId: 'cloud://original' };
  let pending = api.getMine(); calls[0].resolve(profile); await pending;
  now += 31000;
  assert.equal((await api.getMine()).avatarUrl, 'https://example.test/avatar-1');
  assert.equal(calls.length, 1); assert.equal(urls, 1);
  now += 300000;
  await api.getMine(); assert.equal(calls.length, 1); assert.equal(urls, 1);
  now += 569000;
  pending = api.getMine(); calls[1].resolve(profile); await pending;
  assert.equal(urls, 2);
  pending = api.updateMine(1, 'renamed', 'same-asset'); calls[2].resolve({ ...profile, nickname: 'renamed' }); await pending;
  await api.getMine(); assert.equal(urls, 2);
  pending = api.updateMine(2, 'renamed', 'new-asset'); calls[3].resolve({ ...profile, avatarFileId: 'cloud://new' }); await pending;
  assert.equal((await api.getMine()).avatarUrl, 'https://example.test/avatar-3');
  now += 900001;
  pending = api.getMine(); calls[4].resolve({ ...profile, avatarFileId: 'cloud://new' }); await pending;
  assert.equal(urls, 4);
  api.clearCache();
  pending = api.getMine(); calls[5].resolve({ ...profile, avatarFileId: 'cloud://new' }); await pending;
  assert.equal(urls, 5);
});

test('saving does not request an unused avatar URL; the next reader resolves it without rereading account', async () => {
  const {api,calls,wx}=harness();let urls=0;
  wx.cloud.getTempFileURL=async()=>{urls++;return {fileList:[{tempFileURL:'https://example.test/avatar'}]};};
  const save=api.updateMine(1,'新昵称','new-avatar');
  calls[0].resolve({id:'one',nickname:'新昵称',avatarFileId:'cloud://avatar',version:2});
  await save;assert.equal(urls,0);
  const mine=await api.getMine();assert.equal(mine.avatarUrl,'https://example.test/avatar');
  assert.equal(urls,1);assert.equal(calls.length,1);
});
test('account switch and logout cannot expose the previous profile or city', async () => {
  const { api, calls, app } = harness();
  const old = api.getMine(), region = api.getDiscoveryPreference();
  app.globalData.account = { id: 'two', nickname: '第二账号' };
  calls[0].resolve({ id: 'one', nickname: '旧账号' });
  calls[1].resolve({ preference: { cityCode: '310000', cityName: '上海', version: 1 } });
  await Promise.all([old, region]);
  assert.equal(api.peekMine().nickname, '第二账号');
  assert.equal(api.peekDiscoveryPreference(), null);
  api.clearCache(); app.globalData.account = null;
  assert.equal(api.peekMine(), null);
});
test('confirmed city survives module reload for the same verified account only', async () => {
  const { api, calls, app, reload } = harness();
  const pending = api.getDiscoveryPreference();
  calls[0].resolve({ preference: { cityCode: '310000', cityName: '上海', version: 1 } });
  await pending;
  assert.equal(api.peekDiscoveryPreference().cityName, '上海');
  assert.equal(reload().peekDiscoveryPreference().cityName, '上海');
  app.globalData.account = null;
  assert.equal(api.peekDiscoveryPreference(), null);
  app.globalData.account = { id: 'one' };
  assert.equal(api.peekDiscoveryPreference().cityName, '上海');
});
test('late preference lookup cannot overwrite a more recent confirmed save', async () => {
  const { api, calls } = harness();
  const read = api.getDiscoveryPreference();
  const save = api.saveDiscoveryPreference(1, { cityCode: '330100', cityName: '杭州' });
  calls[1].resolve({ preference: { cityCode: '330100', cityName: '杭州', version: 2 } }); await save;
  calls[0].resolve({ preference: { cityCode: '310000', cityName: '上海', version: 1 } }); await read;
  assert.equal(api.peekDiscoveryPreference().cityName, '杭州');
});
test('successful profile save replaces cached nickname immediately', async () => {
  const { api, calls } = harness();
  const save = api.updateMine(1, '新昵称');
  calls[0].resolve({ id: 'one', nickname: '新昵称', version: 2 }); await save;
  assert.equal(api.peekMine().nickname, '新昵称');
  assert.equal((await api.getMine()).nickname, '新昵称');
  assert.equal(calls.length, 1);
});

test('verified login preference avoids a second cloud request, other owner cannot seed', async () => {
 const {api,app,calls}=harness();
 api.seedSession({account:app.globalData.account,discoveryPreference:{cityCode:'310000',cityName:'上海',version:1}});
 assert.equal((await api.getDiscoveryPreference()).preference.cityName,'上海'); assert.equal(calls.length,0);
 api.seedSession({account:{id:'other'},discoveryPreference:{cityCode:'330100',cityName:'杭州',version:1}});
 assert.equal(api.peekDiscoveryPreference().cityName,'上海');
});

test('city preference coalesces, reuses across page switches and expires after fifteen minutes', async () => {
  let now = 1000;
  const { api, calls } = harness({ now: () => now });
  const first = api.getDiscoveryPreference(), second = api.getDiscoveryPreference();
  assert.equal(calls.length, 1);
  calls[0].resolve({ preference: { cityCode: '310000', cityName: '上海', version: 1 } });
  await Promise.all([first, second]);
  now += 31000;
  await api.getDiscoveryPreference(); assert.equal(calls.length, 1);
  now += 869000;
  const expired = api.getDiscoveryPreference(); assert.equal(calls.length, 2);
  calls[1].resolve({ preference: null }); await expired;
});

test('optional preference storage failure cannot turn successful cloud location into failure',async()=>{
 const {api,calls,wx}=harness();wx.setStorageSync=()=>{throw Error('quota exceeded');};
 const pending=api.resolveDiscoveryLocation(0,31,121);
 calls[0].resolve({preference:{version:1,cityCode:'310000',cityName:'上海'}});
 assert.equal((await pending).preference.cityCode,'310000');
 assert.equal((await api.getDiscoveryPreference()).preference.version,1);
 assert.equal(calls.length,1);
});
test('verified session preference seeding and cache misses survive unavailable local storage',async()=>{
 const {api,app,wx}=harness();wx.getStorageSync=()=>{throw Error('storage unavailable');};
 assert.equal(api.peekDiscoveryPreference(),null);
 wx.setStorageSync=()=>{throw Error('storage unavailable');};
 assert.doesNotThrow(()=>api.seedSession({account:app.globalData.account,discoveryPreference:{version:2,cityCode:'310000'}}));
 assert.equal((await api.getDiscoveryPreference()).preference.version,2);
});
test('failed cache removal does not interrupt logout or revive old stored city',()=>{
 const {api,app,wx}=harness();api.seedSession({account:app.globalData.account,discoveryPreference:{version:1,cityCode:'310000'}});
 wx.removeStorageSync=()=>{throw Error('storage unavailable');};
 assert.doesNotThrow(()=>api.clearCache());assert.equal(api.peekDiscoveryPreference(),null);
});


test('failed persistence displays the newest confirmed city and a later write restores persistence', async () => {
 const {api,app,wx,reload}=harness();
 api.seedSession({account:app.globalData.account,discoveryPreference:{version:1,cityCode:'310000'}});
 const write=wx.setStorageSync;
 wx.setStorageSync=()=>{throw Error('quota exceeded');};
 api.seedSession({account:app.globalData.account,discoveryPreference:{version:2,cityCode:'330100'}});
 assert.equal(api.peekDiscoveryPreference().cityCode,'330100');
 api.clearCache();assert.equal(api.peekDiscoveryPreference(),null);
 wx.setStorageSync=write;
 api.seedSession({account:app.globalData.account,discoveryPreference:{version:3,cityCode:'320100'}});
 assert.equal(reload().peekDiscoveryPreference().cityCode,'320100');
 app.globalData.account={id:'two'};
 assert.equal(api.peekDiscoveryPreference(),null);
});

test('optional storage handling never converts a cloud rejection into success', async () => {
 const {api,wx}=harness();
 wx.setStorageSync=()=>{throw Error('quota exceeded');};
 wx.cloud.callFunction=async()=>({result:{ok:false,error:{code:'VERSION_CONFLICT',message:'changed'}}});
 await assert.rejects(api.resolveDiscoveryLocation(1,31,121),{code:'VERSION_CONFLICT'});
 assert.equal(api.peekDiscoveryPreference(),null);
});
