const { test } = require('node:test');
const assert = require('node:assert/strict');
const cloudCatalog = require('../miniprogram/services/cloud-catalog');
const cloudAccount = require('../miniprogram/services/cloud-account');
const cloudOrders = require('../miniprogram/services/cloud-orders');
const cloudAvailability = require('../miniprogram/services/cloud-availability');
const definitions = {};
for (const name of ['discover', 'search-results']) {
  global.Page = value => { definitions[name] = value; };
  require(`../miniprogram/pages/${name}/index`);
}
delete global.Page;
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function page(name) {
  const value = { ...definitions[name], data: structuredClone(definitions[name].data), marketProviders: [], marketWorks: [] };
  Object.assign(value.data, { cityCode: '310000', city: '上海', career: '摄影', date: '', searchQuery: '', selectedFilters: [] });
  value.setData = (patch, callback) => { Object.assign(value.data, patch); if (callback) callback(); };
  value.refreshResults = () => { value.refreshCount = (value.refreshCount || 0) + 1; };
  return value;
}
const response = id => ({ providers: [{ id, nickname: id, services: [], works: [] }] });

test('work pagination merges same-author pages and refreshes when that publication changes', async t => {
  const previous = [global.wx, global.getApp];
  global.wx = { getStorageSync() {}, setStorageSync() {} };
  global.getApp = () => ({ globalData: { account: { id: 'reader' } } });
  const cache = require('../miniprogram/utils/display-cache'); cache.clear();
  const { loadDiscoveryPage } = require('../miniprogram/utils/discovery-pagination');
  try {
    for (const name of ['discover', 'search-results']) {
      const target = page(name); target.data.mode = 'works'; target.route = `pages/${name}/index`;
      let calls = 0;
      const stub = t.mock.method(cloudCatalog, 'listDiscovery', async filters => {
        assert.equal(filters.pageUnit, 'work'); calls++;
        if (calls === 1) return { providers: [{ id: 'a', version: 1, services: [], works: [{ id: 'one' }] }], nextCursor: '1' };
        if (calls === 2) return { providers: [{ id: 'a', version: 1, services: [], works: [{ id: 'two' }] }], nextCursor: '2' };
        if (calls === 3) return { providers: [{ id: 'a', version: 2, services: [], works: [{ id: 'changed-tail' }] }], nextCursor: null };
        assert.equal(filters.cursor, undefined);
        return { providers: [{ id: 'a', version: 2, services: [], works: [{ id: 'new-first' }] }], nextCursor: null };
      });
      await loadDiscoveryPage(target); await loadDiscoveryPage(target, true);
      assert.deepEqual(target.marketWorks.map(w => w.id), ['one', 'two']);
      await loadDiscoveryPage(target, true);
      assert.equal(calls, 4); assert.deepEqual(target.marketWorks.map(w => w.id), ['new-first']);
      stub.mock.restore(); cache.clear();
    }
  } finally { cache.clear(); [global.wx, global.getApp] = previous; }
});

test('fresh startup location overrides a still-valid old-city cache, without querying the old city first', async t => {
  const previous = [global.wx, global.getApp], ready = deferred();
  const app = { globalData: {}, discoveryLocationReady: ready.promise };
  global.wx = { getStorageSync() {}, setStorageSync() {} }; global.getApp = () => app;
  const preference = { cityCode: '310000', cityName: '上海', source: 'MANUAL', version: 1 };
  t.mock.method(cloudAccount, 'peekDiscoveryPreference', () => preference);
  let preferenceReads = 0;
  t.mock.method(cloudAccount, 'getDiscoveryPreference', async () => { preferenceReads++; return { preference }; });
  t.mock.method(cloudAccount, 'resolveDiscoveryLocation', async () => ({ preference: { ...preference, cityCode: '330100', cityName: '杭州' } }));
  try {
    const target = page('discover'); let reads = 0;
    target.cloudCatalogLoaded = true; target.catalogLoadedAt = Date.now();
    target.catalogCacheRevision = require('../miniprogram/utils/display-cache').revision();
    target.loadCloudCatalog = async () => { reads++; assert.equal(target.data.cityCode, '330100'); };
    const pending = target.initializeDiscovery(); assert.equal(reads, 0);
    assert.equal(preferenceReads, 1, 'preference read starts before location completes');
    app.globalData.pendingDiscoveryLocation = { latitude: 30, longitude: 120 };
    app.discoveryLocationReady = null; ready.resolve(); await pending;
    assert.equal(reads, 1); assert.equal(target.data.cityCode, '330100');
  } finally { [global.wx, global.getApp] = previous; }
});

test('leaving discovery while startup location is pending does not start a hidden-page catalog read', async t => {
  const old = global.getApp, ready = deferred(), app = { globalData: {}, discoveryLocationReady: ready.promise };
  global.getApp = () => app;
  t.mock.method(cloudAccount, 'getDiscoveryPreference', async () => ({ preference: null }));
  try {
    const target = page('discover'); target.loadCloudCatalog = () => assert.fail('hidden read');
    const pending = target.initializeDiscovery(); target.onHide();
    app.discoveryLocationReady = null; ready.resolve(); await pending;
    assert.equal(target.discoveryInitializing, false);
  } finally { global.getApp = old; }
});

test('parallel location and preference wait for both and use the acknowledged version exactly once', async t => {
  const old = global.getApp, ready = deferred(), saved = deferred();
  const app = { globalData: {}, discoveryLocationReady: ready.promise };
  global.getApp = () => app;
  let preferenceReads = 0, resolutions = 0, catalogs = 0;
  t.mock.method(cloudAccount, 'peekDiscoveryPreference', () => null);
  t.mock.method(cloudAccount, 'getDiscoveryPreference', () => { preferenceReads++; return saved.promise; });
  t.mock.method(cloudAccount, 'resolveDiscoveryLocation', async (version, latitude, longitude) => {
    resolutions++; assert.equal(version, 9); assert.equal(latitude, 30); assert.equal(longitude, 120);
    return { preference: { cityCode: '330100', cityName: '杭州', source: 'MANUAL', version: 10 } };
  });
  try {
    const target = page('discover'); target.loadCloudCatalog = async () => { catalogs++; };
    const pending = target.initializeDiscovery(); await target.initializeDiscovery();
    assert.equal(preferenceReads, 1);
    app.globalData.pendingDiscoveryLocation = { latitude: 30, longitude: 120 };
    app.discoveryLocationReady = null; ready.resolve(); await Promise.resolve();
    assert.equal(resolutions, 0); assert.equal(catalogs, 0);
    saved.resolve({ preference: { version: 9 } }); await pending;
    assert.equal(resolutions, 1); assert.equal(catalogs, 1); assert.equal(target.data.cityCode, '330100');
  } finally { global.getApp = old; }
});

test('leaving during city resolution discards the old city and allows the next opening to initialize', async t => {
  const previous = [global.wx, global.getApp], resolved = deferred();
  const app = { globalData: { pendingDiscoveryLocation: { latitude: 31, longitude: 121 } } };
  global.wx = { getStorageSync() {}, setStorageSync() {} }; global.getApp = () => app;
  const preference = { cityCode: '310000', cityName: '上海', source: 'MANUAL', version: 1 };
  t.mock.method(cloudAccount, 'peekDiscoveryPreference', () => preference);
  t.mock.method(cloudAccount, 'getDiscoveryPreference', async () => ({ preference }));
  t.mock.method(cloudAccount, 'resolveDiscoveryLocation', () => resolved.promise);
  try {
    const target = page('discover'); target.loadCloudCatalog = () => assert.fail('late city read');
    const pending = target.initializeDiscovery(); await Promise.resolve(); target.onHide();
    resolved.resolve({ preference: { ...preference, cityCode: '330100', cityName: '杭州' } });
    await pending;
    assert.equal(target.data.cityCode, '310000'); assert.equal(target.discoveryInitializing, false);
  } finally { [global.wx, global.getApp] = previous; }
});

for (const fails of [false, true]) test(`location ${fails ? 'failure restores cached city' : 'same-city success'} starts catalog once`, async t => {
  const previous = [global.wx, global.getApp];
  const app = { globalData: { pendingDiscoveryLocation: { latitude: 31, longitude: 121 } } };
  global.wx = { getStorageSync() {}, setStorageSync() {} };
  global.getApp = () => app;
  const preference = { cityCode: '310000', cityName: '上海', provinceName: '上海市', source: 'MANUAL', version: 1 };
  t.mock.method(cloudAccount, 'peekDiscoveryPreference', () => preference);
  t.mock.method(cloudAccount, 'getDiscoveryPreference', async () => ({ preference }));
  t.mock.method(cloudAccount, 'resolveDiscoveryLocation', async () => { if (fails) throw Error('unavailable'); return { preference }; });
  try {
    const target = page('discover'); let reads = 0;
    target.loadCloudCatalog = async () => { reads++; target.setData({ catalogLoading: false }); };
    await target.initializeDiscovery();
    assert.equal(reads, 1); assert.equal(target.data.cityCode, '310000');
    assert.equal(target.data.catalogLoading, false); assert.equal(target.discoveryInitializing, false);
    assert.equal(app.globalData.pendingDiscoveryLocation, undefined);
  } finally { [global.wx, global.getApp] = previous; }
});

test('unchanged storefront navigation returns to the same workbench without a reload; publication invalidation refreshes', () => {
  const previous = [global.wx, global.getApp];
  const cache = require('../miniprogram/utils/display-cache');
  let url, loads = 0;
  global.wx = { getStorageSync: () => 'provider', removeStorageSync() {}, navigateTo: options => { url = options.url; } };
  global.getApp = () => ({ globalData: { account: { id: 'owner' } } });
  try {
    const target = page('discover'); target.data.role = 'provider'; target.dashboardOwner = 'owner';
    target.data.storefrontPublished = false; target.syncNativeTabBar = () => {};
    target.loadProviderDashboard = () => loads++;
    target.openProviderProfile(); assert.match(url, /from=workbench/);
    target.onShow(); assert.equal(loads, 0); assert.equal(target.data.storefrontPublished, false);
    target.openProviderProfile(); cache.clear(); target.onShow(); assert.equal(loads, 1);
    target.openProviderProfile(); target.storefrontReturn.at -= 900000; target.onShow(); assert.equal(loads, 2);
  } finally { [global.wx, global.getApp] = previous; }
});

test('discover refreshes after publication invalidation or expiry but reuses a fresh first page', async t => {
  const cache = require('../miniprogram/utils/display-cache');
  const previous = [global.wx, global.getApp];
  global.wx = { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} };
  global.getApp = () => ({ globalData: { account: { id: 'viewer' } } });
  let now = 1000000, reads = 0;
  t.mock.method(Date, 'now', () => now);
  const preference = { cityCode: '310000', cityName: '上海', provinceName: '上海市', source: 'MANUAL', version: 1 };
  t.mock.method(cloudAccount, 'peekDiscoveryPreference', () => preference);
  t.mock.method(cloudAccount, 'getDiscoveryPreference', async () => ({ preference }));
  t.mock.method(cloudCatalog, 'listDiscovery', async () => { reads++; return response('published-' + reads); });
  try {
    const target = page('discover');
    await target.loadCloudCatalog();
    assert.equal(reads, 1);
    await target.initializeDiscovery();
    assert.equal(reads, 1);
    cache.clear();
    await target.initializeDiscovery();
    assert.equal(reads, 2);
    assert.equal(target.catalogProviders[0].id, 'published-2');
    now += 300000;
    await target.initializeDiscovery();
    assert.equal(reads, 3);
    assert.equal(target.catalogProviders[0].id, 'published-3');
    now += 300000;
    const delayed = deferred();
    t.mock.method(cloudCatalog, 'listDiscovery', () => delayed.promise);
    const refreshing = target.initializeDiscovery();
    assert.equal(target.data.catalogLoading, false);
    assert.equal(target.data.catalogCached, true);
    assert.equal(target.catalogProviders[0].id, 'published-3');
    delayed.reject(new Error('offline'));
    await refreshing;
    assert.equal(target.catalogProviders[0].id, 'published-3');
  } finally { [global.wx, global.getApp] = previous; }
});

test('search return clears committed and draft filters while preserving career, keyword and browsing mode', () => {
  const origin = page('discover'); origin.discovery = structuredClone(definitions.discover.discovery);
  Object.assign(origin.data, { role: 'buyer', mode: 'people', searchQuery: '保留关键词', selectedFilters: ['￥1000以下'], filterDraft: ['￥1000以下'], filterOpen: true });
  origin.cloudCatalogLoaded = true;
  const search = page('search-results'); search.discoveryOrigin = origin; search.onUnload();
  assert.deepEqual(origin.data.selectedFilters, []); assert.deepEqual(origin.data.filterDraft, []);
  assert.deepEqual(origin.discovery.摄影.filters, []);
  assert.equal(origin.data.mode, 'people'); assert.equal(origin.data.searchQuery, '保留关键词');
  assert.equal(origin.data.filterOpen, false); assert.equal(origin.data.priceActive, false);
  assert.equal(origin.cloudCatalogLoaded, false); assert.equal(search.discoveryOrigin, null);
});

for (const name of Object.keys(definitions)) {
  test(`${name}: works mode preserves service keyword matches but filters by work price and tags`, async () => {
    const previous = cloudCatalog.listDiscovery;
    const { applyDiscovery, discoveryOptions } = require('../cloudfunctions/catalog-read/catalog-core');
    const { filterOptions } = require('../miniprogram/data/catalog');
    const tag = filterOptions.摄影.flatMap(group => group.values).find(value => !value.startsWith('￥'));
    try {
      for (const scenario of [{ searchQuery: '服务关键词', selectedFilters: [], expected: ['work'] },
        { searchQuery: '', selectedFilters: ['￥1000以下'], expected: [] }, { searchQuery: '', selectedFilters: [tag], expected: [] }]) {
        const target = page(name); target.refreshResults = definitions[name].refreshResults;
        Object.assign(target.data, scenario);
        cloudCatalog.listDiscovery = async filters => {
          assert.equal(filters.mode, 'works');
          const providers = applyDiscovery({ providers: [{ id: 'author', nickname: '作者', career: '摄影', city: '上海', cityCode: '310000', tags: [],
            services: [{ id: 'service', name: '服务关键词', description: tag, priceFen: 80000, serviceMode: 'ONLINE' }],
            works: [{ id: 'work', serviceId: 'service', title: '样片', priceFen: 250000, tags: [] }] }] }, discoveryOptions(filters));
          assert.equal(providers.length, scenario.expected.length, 'actual server rules must match');
          return { providers, nextCursor: null };
        };
        await target.loadCloudCatalog();
        const works = name === 'discover' ? target.data.visibleWorks : target.data.results;
        assert.deepEqual(works.map(work => work.id), scenario.expected, JSON.stringify(scenario));
        target.auditMode = true; target.refreshResults();
        const previewWorks = name === 'discover' ? target.data.visibleWorks : target.data.results;
        assert.deepEqual(previewWorks, [], 'local preview retains its existing filters');
      }
    } finally { cloudCatalog.listDiscovery = previous; }
  });

  test(`${name}: authors sharing a work ID retain separate render keys across pages`, async () => {
    const previous = cloudCatalog.listDiscovery;
    try {
      const target = page(name); target.refreshResults = definitions[name].refreshResults;
      cloudCatalog.listDiscovery = async filters => ({ providers: [{ id: filters.cursor ? 'author_b' : 'author_a', nickname: '作者',
        services: [], works: [{ id: 'same_work', title: '作品', tags: [] }] }], nextCursor: filters.cursor ? null : '50' });
      await target.loadCloudCatalog(); await target.loadMoreCatalog();
      const works = name === 'discover' ? target.data.visibleWorks : target.data.results;
      assert.equal(works.length, 2);
      assert.deepEqual(works.map(work => work.listKey), ['author_a:same_work', 'author_b:same_work']);
      assert.deepEqual(works.map(work => work.id), ['same_work', 'same_work']);
    } finally { cloudCatalog.listDiscovery = previous; }
  });

  test(`${name}: provider dashboard and audit preview do not request more public data`, async () => {
    const previous = cloudCatalog.listDiscovery;
    try {
      let calls = 0; cloudCatalog.listDiscovery = async () => { calls++; return response('unexpected'); };
      const target = page(name); target.data.catalogNextCursor = '50'; target.data.role = 'provider';
      await target.onReachBottom();
      target.data.role = 'buyer'; target.auditMode = true;
      await target.onReachBottom(); assert.equal(calls, 0);
    } finally { cloudCatalog.listDiscovery = previous; }
  });

  test(`${name}: pagination appends, deduplicates and retries the same cursor without losing results`, async () => {
    const previous = cloudCatalog.listDiscovery;
    try {
      const target = page(name), calls = [];
      cloudCatalog.listDiscovery = async filters => { calls.push(filters); return { ...response('first'), nextCursor: '50' }; };
      await target.loadCloudCatalog();
      const next = deferred();
      cloudCatalog.listDiscovery = filters => { calls.push(filters); return next.promise; };
      const run = target.onReachBottom();
      await target.loadMoreCatalog();
      assert.equal(calls.length, 2);
      assert.equal(calls[1].cursor, '50');
      assert.equal(target.data.catalogLoading, false);
      next.reject(new Error('network')); await run;
      assert.deepEqual(target.marketProviders.map(p => p.id), ['first']);
      assert.ok(target.data.catalogMoreError);
      assert.equal(target.data.catalogNextCursor, '50');
      cloudCatalog.listDiscovery = async filters => { calls.push(filters); return { providers: [...response('first').providers, ...response('second').providers], nextCursor: null }; };
      await target.loadMoreCatalog();
      assert.equal(calls[2].cursor, '50');
      assert.deepEqual(target.marketProviders.map(p => p.id), ['first', 'second']);
      assert.equal(target.data.catalogMoreError, '');
      await target.onReachBottom();
      assert.equal(calls.length, 3);
    } finally { cloudCatalog.listDiscovery = previous; }
  });

  test(`${name}: old pagination cannot append after a new search or unload`, async () => {
    const previous = cloudCatalog.listDiscovery;
    try {
      for (const unload of [false, true]) {
        const target = page(name);
        cloudCatalog.listDiscovery = async () => ({ ...response('first'), nextCursor: '50' });
        await target.loadCloudCatalog();
        const old = deferred(); cloudCatalog.listDiscovery = () => old.promise;
        const run = target.loadMoreCatalog();
        if (unload) target.onUnload();
        else {
          target.data.searchQuery = 'new';
          cloudCatalog.listDiscovery = async filters => { assert.equal(filters.cursor, undefined); return response('new'); };
          await target.loadCloudCatalog();
        }
        old.resolve(response('obsolete')); await run;
        assert.deepEqual(target.marketProviders.map(p => p.id), [unload ? 'first' : 'new']);
      }
    } finally { cloudCatalog.listDiscovery = previous; }
  });

  test(`${name}: old success and failure cannot overwrite the latest result`, async () => {
    const previous = cloudCatalog.listDiscovery;
    try {
      for (const oldFails of [false, true]) {
        const old = deferred(), current = deferred(); let calls = 0;
        cloudCatalog.listDiscovery = () => (++calls === 1 ? old : current).promise;
        const target = page(name);
        const first = target.loadCloudCatalog(); await Promise.resolve();
        target.data.searchQuery = 'new';
        const second = target.loadCloudCatalog(); await Promise.resolve();
        current.resolve(response('new')); await second;
        if (oldFails) old.reject(new Error('old request failed')); else old.resolve(response('old'));
        await first;
        assert.equal(target.marketProviders[0].id, 'new');
        assert.equal(target.data.catalogError, '');
        assert.equal(target.data.catalogLoading, false);
        assert.equal(target.refreshCount, 1);
      }
    } finally { cloudCatalog.listDiscovery = previous; }
  });

  test(`${name}: unloading invalidates the response and the latest failure remains retryable`, async () => {
    const previous = cloudCatalog.listDiscovery;
    try {
      const pending = deferred(); cloudCatalog.listDiscovery = () => pending.promise;
      const target = page(name), run = target.loadCloudCatalog(); await Promise.resolve();
      target.onUnload(); pending.resolve(response('late')); await run;
      assert.deepEqual(target.marketProviders, []);
      cloudCatalog.listDiscovery = async () => { throw new Error('current failure'); };
      const reopened = page(name); await reopened.loadCloudCatalog();
      assert.ok(reopened.data.catalogError); assert.equal(reopened.data.catalogLoading, false);
      cloudCatalog.listDiscovery = async () => response('retry'); await reopened.loadCloudCatalog();
      assert.equal(reopened.marketProviders[0].id, 'retry'); assert.equal(reopened.data.catalogError, '');
    } finally { cloudCatalog.listDiscovery = previous; }
  });
}

test('search-results: a stale city lookup cannot restore old region or send an obsolete request', async () => {
  const previous = cloudCatalog.listDiscovery, previousPreference = cloudAccount.getDiscoveryPreference;
  const target = page('search-results'); target.data.cityCode = '';
  const lookup = deferred(); const queries = [];
  cloudAccount.getDiscoveryPreference = () => lookup.promise;
  cloudCatalog.listDiscovery = async filters => { queries.push(filters); return response('new'); };
  try {
    const first = target.loadCloudCatalog();
    Object.assign(target.data, { cityCode: '310000', city: '上海' });
    await target.loadCloudCatalog();
    lookup.resolve({ preference: { cityCode: '330100', cityName: '杭州' } }); await first;
    assert.equal(target.data.cityCode, '310000'); assert.equal(queries.length, 1);
  } finally { cloudCatalog.listDiscovery = previous; cloudAccount.getDiscoveryPreference = previousPreference; }
});

test('discover dashboard: old results and failures cannot replace a refreshed account', async () => {
  const previous = [cloudAccount.getMine, cloudOrders.listOrders, cloudAvailability.getMine, cloudCatalog.getProvider];
  try {
    cloudOrders.listOrders = async () => [];
    cloudAvailability.getMine = async () => ({ openDates: [] });
    for (const oldFails of [false, true]) {
      const old = deferred(), started = deferred();
      cloudAccount.getMine = async () => ({ id: 'old', nickname: 'Old' });
      cloudCatalog.getProvider = id => { if (id === 'old') { started.resolve(); return old.promise; } return Promise.resolve({ provider: null }); };
      const target = page('discover');
      const first = target.loadProviderDashboard(); await started.promise;
      cloudAccount.getMine = async () => ({ id: 'new', nickname: 'New' });
      await target.loadProviderDashboard();
      if (oldFails) old.reject(new Error('stale failure')); else old.resolve({ provider: null });
      await first;
      assert.equal(target.data.profile.nickname, 'New');
      assert.equal(target.data.providerVisibilityText, '主页尚未公开'); assert.equal(target.data.storefrontPublished, false);
      assert.equal(target.data.dashboardError, '');
      assert.equal(target.data.dashboardLoading, false);
    }
  } finally { [cloudAccount.getMine, cloudOrders.listOrders, cloudAvailability.getMine, cloudCatalog.getProvider] = previous; }
});

test('discover dashboard: unloaded or buyer pages discard a delayed account before requesting private data', async () => {
  const previous = [cloudAccount.getMine, cloudOrders.listOrders, global.wx];
  try {
    for (const leave of ['unload', 'buyer']) {
      const pending = deferred(); let orderReads = 0;
      cloudAccount.getMine = () => pending.promise;
      cloudOrders.listOrders = async () => { orderReads++; return []; };
      const target = page('discover');
      const first = target.loadProviderDashboard();
      if (leave === 'unload') target.onUnload();
      else {
        global.wx = { getStorageSync: () => 'buyer' };
        target.initializeDiscovery = () => {};
        target.onShow();
      }
      const before = structuredClone(target.data);
      pending.resolve({ id: 'old', nickname: 'Old' }); await first;
      assert.equal(orderReads, 0);
      assert.deepEqual(target.data, before);
    }
  } finally { [cloudAccount.getMine, cloudOrders.listOrders, global.wx] = previous; }
});

test('discover dashboard: current failure can be retried', async () => {
  const previous = [cloudAccount.getMine, cloudOrders.listOrders, cloudAvailability.getMine, cloudCatalog.getProvider];
  try {
    const target = page('discover');
    cloudAccount.getMine = async () => { throw new Error('unavailable'); };
    await target.loadProviderDashboard();
    assert.ok(target.data.dashboardError);
    assert.equal(target.data.providerVisibilityText, '主页状态暂不可用'); assert.equal(target.data.storefrontPublished, null);
    assert.equal(target.data.dashboardLoading, false);
    cloudAccount.getMine = async () => ({ id: 'current', nickname: 'Current' });
    cloudOrders.listOrders = async () => [];
    cloudAvailability.getMine = async () => ({ openDates: [] });
    cloudCatalog.getProvider = async () => ({ provider: null });
    await target.loadProviderDashboard();
    assert.equal(target.data.profile.nickname, 'Current');
    assert.equal(target.data.providerVisibilityText, '主页尚未公开');
    assert.equal(target.data.dashboardError, '');
  } finally { [cloudAccount.getMine, cloudOrders.listOrders, cloudAvailability.getMine, cloudCatalog.getProvider] = previous; }
});

test('discover dashboard: public visibility follows the latest public catalogue, including withdrawal', async () => {
  const previous = [cloudAccount.getMine, cloudOrders.listOrders, cloudAvailability.getMine, cloudCatalog.getProvider];
  try {
    cloudAccount.getMine = async () => ({ id: 'current', nickname: 'Current' });
    cloudOrders.listOrders = async () => [];
    cloudAvailability.getMine = async () => ({ openDates: [] });
    cloudCatalog.getProvider = async () => ({ provider: { career: '摄影', works: [], services: [] } });
    const target = page('discover');
    await target.loadProviderDashboard();
    assert.equal(target.data.providerVisibilityText, '主页公开展示中'); assert.equal(target.data.storefrontPublished, true);
    const pending = deferred(); cloudCatalog.getProvider = () => pending.promise;
    const refresh = target.loadProviderDashboard();
    assert.equal(target.data.providerVisibilityText, '');
    pending.resolve({ provider: null }); await refresh;
    assert.equal(target.data.providerVisibilityText, '主页尚未公开');
  } finally { [cloudAccount.getMine, cloudOrders.listOrders, cloudAvailability.getMine, cloudCatalog.getProvider] = previous; }
});

test('discover: saved city lookup cannot undo a manual region or update an unloaded page', async () => {
  const previous = [cloudAccount.getDiscoveryPreference, cloudCatalog.listDiscovery];
  try {
    for (const leave of ['manual', 'unload']) {
      const pending = deferred();
      cloudAccount.getDiscoveryPreference = () => pending.promise;
      cloudCatalog.listDiscovery = async () => response('manual');
      const target = page('discover');
      const first = target.initializeDiscovery();
      if (leave === 'manual') await target.applyDiscoveryRegion({ cityCode: '310000', cityName: '上海市' }, false);
      else target.onUnload();
      const before = structuredClone(target.data);
      pending.resolve({ preference: { cityCode: '330100', cityName: '杭州市', version: 3, source: 'MANUAL' } });
      await first;
      assert.deepEqual(target.data, before);
    }
  } finally { [cloudAccount.getDiscoveryPreference, cloudCatalog.listDiscovery] = previous; }
});

test('discover: consecutive city saves use the acknowledged version and only load the latest city', async () => {
  const previous = [cloudAccount.getDiscoveryPreference, cloudAccount.saveDiscoveryPreference, cloudCatalog.listDiscovery];
  const firstSave = deferred(), started = deferred();
  const saves = [], queries = [];
  try {
    cloudAccount.getDiscoveryPreference = async () => ({ preference: { version: 4 } });
    cloudAccount.saveDiscoveryPreference = (version, region) => {
      saves.push({ version, cityCode: region.cityCode });
      if (saves.length === 1) { started.resolve(); return firstSave.promise; }
      return Promise.resolve({ preference: { version: 6 } });
    };
    cloudCatalog.listDiscovery = async filters => { queries.push(filters); return response('latest'); };
    const target = page('discover');
    const first = target.applyDiscoveryRegion({ cityCode: '330100', cityName: '杭州' }, true);
    await started.promise;
    const second = target.applyDiscoveryRegion({ cityCode: '310000', cityName: '上海' }, true);
    await target.initializeDiscovery();
    assert.equal(target.data.cityCode, '310000');
    firstSave.resolve({ preference: { version: 5 } });
    await Promise.all([first, second]);
    assert.deepEqual(saves, [{ version: 4, cityCode: '330100' }, { version: 5, cityCode: '310000' }]);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].cityCode, '310000');
    assert.equal(target.discoveryPreferenceVersion, 6);
  } finally { [cloudAccount.getDiscoveryPreference, cloudAccount.saveDiscoveryPreference, cloudCatalog.listDiscovery] = previous; }
});

test('discover: failed city save refreshes the version on retry and never loads unsaved results', async () => {
  const previous = [cloudAccount.getDiscoveryPreference, cloudAccount.saveDiscoveryPreference, cloudCatalog.listDiscovery];
  try {
    let lookups = 0; const queries = [], versions = [];
    cloudAccount.getDiscoveryPreference = async () => ({ preference: { version: ++lookups } });
    cloudAccount.saveDiscoveryPreference = async version => {
      versions.push(version);
      if (versions.length === 1) throw new Error('version conflict');
      return { preference: { version: 3 } };
    };
    cloudCatalog.listDiscovery = async filters => { queries.push(filters); return response('retry'); };
    const target = page('discover');
    const event = { detail: { value: ['上海市', '上海市', '黄浦区'], code: ['310000', '310000', '310101'] } };
    await target.updateCity(event);
    assert.ok(target.data.catalogError);
    assert.equal(queries.length, 0);
    assert.equal(target.discoveryRegionSaving, false);
    await target.updateCity(event);
    assert.deepEqual(versions, [1, 2]);
    assert.equal(queries.length, 1);
    assert.equal(target.data.catalogError, '');
  } finally { [cloudAccount.getDiscoveryPreference, cloudAccount.saveDiscoveryPreference, cloudCatalog.listDiscovery] = previous; }
});

test('discover: queued city save is cancelled on unload and late failure cannot touch the page', async () => {
  const previous = cloudAccount.saveDiscoveryPreference;
  const pending = deferred(), started = deferred(); let calls = 0;
  try {
    cloudAccount.saveDiscoveryPreference = () => { calls++; started.resolve(); return pending.promise; };
    const target = page('discover'); target.discoveryPreferenceVersion = 2;
    const first = target.applyDiscoveryRegion({ cityCode: '330100', cityName: '杭州' }, true);
    await started.promise;
    const second = target.applyDiscoveryRegion({ cityCode: '310000', cityName: '上海' }, true);
    target.onUnload(); const before = structuredClone(target.data);
    pending.reject(new Error('late failure')); await Promise.all([first, second]);
    assert.equal(calls, 1); assert.deepEqual(target.data, before);
  } finally { cloudAccount.saveDiscoveryPreference = previous; }
});


test('provider dashboard failure removes unusable old rows and retry restores order navigation', async t => {
  global.wx = { navigateTo() {} };
  const target = page('discover'); target.data.role = 'provider';
  target.data.priorityOrders = [{ id: 'old' }]; target.data.metrics = [{ count: 8 }]; target.data.overview = [{ value: 'old' }]; target.data.priorityTotal = 8;
  t.mock.method(cloudAccount, 'peekMine', () => null);
  t.mock.method(cloudAccount, 'getMine', async () => { throw Error('offline'); });
  await target.loadProviderDashboard();
  assert.deepEqual(target.data.priorityOrders, []); assert.deepEqual(target.data.metrics, []); assert.deepEqual(target.data.overview, []); assert.equal(target.data.priorityTotal, 0);
  assert.match(target.data.dashboardError, /重试/);
  let release, calls = 0;
  t.mock.method(cloudAccount, 'getMine', () => { calls++; return new Promise(resolve => { release = resolve; }); });
  t.mock.method(cloudCatalog, 'getProvider', async () => ({ provider: null }));
  t.mock.method(cloudOrders, 'listOrders', async () => [{ id: 'fresh', providerId: 'owner', stage: 'REQUESTED' }]);
  t.mock.method(cloudAvailability, 'getMine', async () => ({ openDates: [] }));
  const retry = target.retryDashboard(); await target.retryDashboard(); assert.equal(calls, 1);
  release({ id: 'owner', nickname: '作者' }); await retry;
  assert.equal(target.data.dashboardError, ''); assert.equal(target.data.priorityOrders[0].id, 'fresh');
  const navigation = t.mock.method(wx, 'navigateTo'); target.openPriority({ currentTarget: { dataset: { id: 'fresh' } } });
  assert.equal(navigation.mock.calls[0].arguments[0].url, '/pages/provider-request/index?id=fresh');
  target.onUnload(); await target.retryDashboard(); assert.equal(calls, 1);
});


test('workbench clears the previous owner and ignores responses and order taps after account changes', async t => {
  const app = { globalData: { account: { id: 'new' } } };
  const previousApp = global.getApp; global.getApp = () => app; t.after(() => { if (previousApp) global.getApp = previousApp; else delete global.getApp; });
  t.mock.method(cloudAccount, 'peekMine', () => null);
  const pending = deferred(); t.mock.method(cloudAccount, 'getMine', () => pending.promise);
  let orderReads = 0; t.mock.method(cloudOrders, 'listOrders', async () => { orderReads++; return []; });
  const target = page('discover'); target.dashboardOwner = 'old'; target.dashboardCloudMode = true;
  target.providerOrders = [{ id: 'old-order', stage: 'REQUESTED' }];
  Object.assign(target.data, { role: 'provider', profile: { nickname: 'Old' }, profileInitial: 'O', priorityOrders: [{ id: 'old-order' }], metrics: [{ count: 3 }], overview: [{ value: 'old' }] });
  const load = target.loadProviderDashboard();
  assert.equal(target.data.profile, null); assert.deepEqual(target.data.priorityOrders, []); assert.deepEqual(target.data.metrics, []); assert.deepEqual(target.data.overview, []);
  app.globalData.account = { id: 'third' }; const before = structuredClone(target.data);
  pending.resolve({ id: 'new', nickname: 'New' }); await load;
  assert.equal(orderReads, 0); assert.deepEqual(target.data, before);
  const navigation = t.mock.method(wx, 'navigateTo'); target.providerOrders = [{ id: 'new-order', stage: 'REQUESTED' }];
  target.openPriority({ currentTarget: { dataset: { id: 'new-order' } } }); assert.equal(navigation.mock.calls.length, 0);
});


test('workbench upload enters the existing independent work editor without publishing', () => {
 const previousWx = global.wx, previousPage = global.Page; let compatibility;
 global.Page = value => { compatibility = value; }; require('../miniprogram/pages/provider-home/index');
 try {
  const urls = []; global.wx = { navigateTo({url}) { urls.push(url); } };
  const target = page('discover'); target.openProviderWork(); target.auditMode = true; target.openProviderWork(); compatibility.openProviderWork();
  assert.deepEqual(urls, ['/pages/provider-profile/index?edit=1&section=works', '/pages/provider-profile/index?edit=1&section=works&audit=1', '/pages/provider-profile/index?edit=1&section=works&audit=1']);
 } finally { global.wx = previousWx; if(previousPage)global.Page=previousPage;else delete global.Page; }
});

test('provider first screen does not request or wait for unrelated full availability data',async t=>{
 global.getApp=()=>({globalData:{account:{id:'fast-owner'}}});
 t.mock.method(cloudAccount,'peekMine',()=>({id:'fast-owner',nickname:'Fast'}));
 t.mock.method(cloudAccount,'getMine',async()=>({id:'fast-owner',nickname:'Fast'}));
 t.mock.method(cloudOrders,'listOrders',async()=>[]);
 t.mock.method(cloudCatalog,'getProvider',async()=>({provider:null}));
 let requests=0;t.mock.method(cloudAvailability,'getMine',()=>{requests++;return new Promise(()=>{});});
 const target=page('discover');await target.loadProviderDashboard();assert.equal(requests,0);assert.equal(target.data.dashboardLoading,false);assert.equal(target.data.dashboardError,'');assert.equal(target.data.profile.nickname,'Fast');assert.deepEqual(target.data.metrics.map(x=>x.count),[0,0,0]);
});


test('nearby fallback updates picker and pagination context without changing the saved home city',async t=>{
 const previous=[global.wx,global.getApp];global.wx={getStorageSync(){},setStorageSync(){},removeStorageSync(){}};global.getApp=()=>({globalData:{account:{id:'viewer'}}});
 const requests=[];t.mock.method(cloudCatalog,'listDiscovery',async filters=>{requests.push(filters);return requests.length===1?{providers:[{id:'p',nickname:'创作者',services:[],works:[{id:'w',providerId:'p',priceFen:100,tags:[],imageUrls:[]}]}],region:{cityCode:'330100',cityName:'杭州市',provinceName:'浙江省',districtName:''},fallbackFrom:'310000',nextCursor:'1'}:{providers:[],nextCursor:null};});
 try { const target=page('discover');target.route='pages/discover/index';await target.loadCloudCatalog();assert.equal(target.data.cityCode,'330100');assert.equal(target.data.regionValue[1],'杭州市');assert.match(target.data.locationMessage,/杭州市/);assert.equal(requests[0].nearest,true);await target.loadMoreCatalog();assert.equal(requests[1].cityCode,'330100');assert.equal(requests[1].cursor,'1');assert.equal(requests[1].nearest,undefined);assert.equal(requests[1].serviceableOnly,true); }finally{[global.wx,global.getApp]=previous;}
});
