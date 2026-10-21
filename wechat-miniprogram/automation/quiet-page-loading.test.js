const { test } = require('node:test');
const assert = require('node:assert/strict');
const cloudAccount = require('../miniprogram/services/cloud-account');
const cloudOrders = require('../miniprogram/services/cloud-orders');
const cloudCatalog = require('../miniprogram/services/cloud-catalog');
const cloudSaved = require('../miniprogram/services/cloud-saved-items');
const localPreview = require('../miniprogram/utils/local-preview');
const calendar = require('../miniprogram/data/calendar-model');
const definitions = {};
for (const name of ['discover', 'me']) { global.Page = value => { definitions[name] = value; }; require(`../miniprogram/pages/${name}/index`); }
delete global.Page;
function page(name) {
  const p = { ...definitions[name], data: structuredClone(definitions[name].data), auditMode: false };
  p.setData = (patch, cb) => { Object.assign(p.data, patch); if (cb) cb(); };
  return p;
}
test.beforeEach(t => {
  global.getApp = () => ({ globalData: { account: { id: 'one' } } });
  global.wx = { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} };
  require('../miniprogram/utils/display-cache').clear();
  t.mock.method(require('../miniprogram/services/background-reads'), 'schedule', () => {});
});
test.afterEach(() => { delete global.getApp; delete global.wx; });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; }
test('connected discovery starts today, refreshes untouched date and preserves manual selection on return', () => {
  const old = localPreview.isAudit;
  global.wx = { getStorageSync() { return 'buyer'; } };
  localPreview.isAudit = () => false;
  try {
    const p = page('discover'); p.refreshFilterGroups = () => {}; p.onLoad({});
    assert.equal(p.data.date, calendar.todayKey());
    p.initializeDiscovery = () => {}; p.data.date = '2020-01-01'; p.onShow();
    assert.equal(p.data.date, calendar.todayKey());
    p.loadCloudCatalog = () => {}; p.updateDate({ detail: { value: '2026-12-15' } }); p.onShow();
    assert.equal(p.data.date, '2026-12-15');
  } finally { localPreview.isAudit = old; delete global.wx; }
});
test('confirmed city renders and directory request starts before slow preference lookup finishes', async () => {
  const old = [cloudAccount.peekDiscoveryPreference, cloudAccount.getDiscoveryPreference];
  const region = { cityCode: '310000', cityName: '上海市', provinceName: '上海市', version: 1, source: 'MANUAL' };
  const lookup = deferred();
  cloudAccount.peekDiscoveryPreference = () => region;
  cloudAccount.getDiscoveryPreference = () => lookup.promise;
  try {
    const p = page('discover'); let requests = 0; p.loadCloudCatalog = () => { requests++; return Promise.resolve(); };
    const pending = p.initializeDiscovery();
    assert.equal(p.data.cityCode, '310000'); assert.equal(p.data.locationMessage, ''); assert.equal(requests, 1);
    lookup.resolve({ preference: region }); await pending;
    assert.equal(requests, 1);
  } finally { [cloudAccount.peekDiscoveryPreference, cloudAccount.getDiscoveryPreference] = old; }
});
test('buyer identity displays immediately and statistics start in parallel without requesting a provider catalogue', async () => {
  const old = [cloudAccount.peekMine, cloudAccount.getMine, cloudOrders.listOrders, cloudSaved.listMine, cloudCatalog.getProvider];
  const account = deferred(), orders = deferred(), saved = deferred(); let orderCalls = 0, savedCalls = 0;
  cloudAccount.peekMine = () => ({ id: 'one', nickname: '现有昵称' }); cloudAccount.getMine = () => account.promise;
  cloudOrders.listOrders = () => { orderCalls++; return orders.promise; };
  cloudSaved.listMine = () => { savedCalls++; return saved.promise; };
  cloudCatalog.getProvider = () => { throw Error('BUYER_CATALOG_NOT_NEEDED'); };
  try {
    const p = page('me'); const pending = p.loadCloudDashboard('buyer');
    assert.equal(p.data.account.nickname, '现有昵称'); assert.equal(orderCalls, 1); assert.equal(savedCalls, 1);
    account.resolve({ id: 'one', nickname: '新昵称' }); await Promise.resolve();
    assert.equal(p.data.account.nickname, '新昵称'); assert.equal(p.data.dashboardLoading, true);
    orders.resolve([]); saved.resolve({ providerIds: [], workIds: [] }); await pending;
    assert.equal(p.data.dashboardError, ''); assert.equal(p.data.dashboardLoading, false);
  } finally { [cloudAccount.peekMine, cloudAccount.getMine, cloudOrders.listOrders, cloudSaved.listMine, cloudCatalog.getProvider] = old; }
});
test('late personal centre response cannot overwrite a newer role or an unloaded page', async () => {
  const old = [cloudAccount.peekMine, cloudAccount.getMine, cloudOrders.listOrders, cloudSaved.listMine, cloudCatalog.getProvider];
  const stale = deferred(); let reads = 0;
  cloudAccount.peekMine = () => null; cloudAccount.getMine = () => ++reads === 1 ? stale.promise : Promise.resolve({ id: 'one', nickname: '当前' });
  cloudOrders.listOrders = async () => []; cloudSaved.listMine = async () => ({ providerIds: [], workIds: [] }); cloudCatalog.getProvider = async () => ({ provider: null });
  try {
    const p = page('me'); const pending = p.loadCloudDashboard('buyer'); await p.loadCloudDashboard('provider');
    p.onUnload(); stale.resolve({ id: 'one', nickname: '过期' }); await pending;
    assert.equal(p.data.account.nickname, '当前'); assert.equal(p.data.role, 'provider');
  } finally { [cloudAccount.peekMine, cloudAccount.getMine, cloudOrders.listOrders, cloudSaved.listMine, cloudCatalog.getProvider] = old; }
});
