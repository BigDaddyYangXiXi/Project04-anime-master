const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const catalog = require('../miniprogram/services/cloud-catalog');
const saved = require('../miniprogram/services/cloud-saved-items');
const orders = require('../miniprogram/services/cloud-orders');
const availability = require('../miniprogram/services/cloud-availability');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise(resolve => setImmediate(resolve));
function page(name, wx = {}) {
  const filename = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: createRequire(filename), wx, Page: value => { definition = value; }, console, setTimeout, clearTimeout });
  const instance = { ...definition, data: structuredClone(definition.data) };
  instance.setData = patch => Object.assign(instance.data, patch);
  return instance;
}
test('work preview rejects a staged draft belonging to another owner with the same work id', t => {
  const preview = require('../miniprogram/data/storefront-preview-draft');
  t.mock.method(require('../miniprogram/utils/local-preview'), 'isAudit', () => false);
  t.mock.method(preview, 'get', () => ({ providerId: 'other', works: [{ id: 'shared' }] }));
  const value = page('work-detail');
  let requested;
  value.loadWork = () => assert.fail('must not display another owner draft');
  value.loadCloudWork = options => { requested = options; };
  value.onLoad({ id: 'shared', providerId: 'requested', workspace: 'provider', preview: 'storefront' });
  assert.equal(requested.providerId, 'requested');
  assert.equal(value.storefrontDraftPreview, false);
});

test('work preview retains matching drafts and legacy unscoped preview links', t => {
  t.mock.method(require('../miniprogram/utils/local-preview'), 'isAudit', () => false);
  t.mock.method(require('../miniprogram/data/storefront-preview-draft'), 'get', () => ({ providerId: 'owner', works: [{ id: 'shared' }] }));
  for (const providerId of ['owner', undefined]) {
    const value = page('work-detail');
    let loaded = false;
    value.loadWork = () => { loaded = true; };
    value.loadCloudWork = () => assert.fail('matching draft must stay local');
    value.onLoad({ id: 'shared', providerId, workspace: 'provider', preview: 'storefront' });
    assert.equal(loaded, true);
  }
});
test('provider work navigation carries its owner and preserves provider workspace', () => {
  let url;
  const value = page('provider-detail', { navigateTo: options => { url = options.url; } });
  value.data.provider = { id: 'provider_2' }; value.providerPreview = true;
  value.openWork({ currentTarget: { dataset: { id: 'work_1' } } });
  assert.equal(url, '/pages/work-detail/index?id=work_1&providerId=provider_2&source=B02&workspace=provider');
});
test('work detail forwards the owner from navigation into the cloud read', async t => {
  let args;
  t.mock.method(catalog, 'getWork', async (...values) => { args = values; return { work: null }; });
  const value = page('work-detail');
  value.loadCloudWork({ id: 'work_1', providerId: 'provider_2' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(args, ['work_1', 'provider_2']);
  assert.equal(value.data.work, null);
});
test('catalog client includes owner in the request and keeps old unscoped links compatible', async () => {
  const requests = [], module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../miniprogram/services/cloud-catalog.js'), 'utf8'), {
    module, require: name => name.endsWith('local-preview') ? { assertCloudAllowed() {} }
      : name.endsWith('utils/cloud-call') ? require('../miniprogram/utils/cloud-call')
      : name.endsWith('config/cloudbase') ? { enabled: true, env: 'test' } : {},
    wx: { cloud: { async callFunction(request) { requests.push(request); return { result: { ok: true, data: { work: null } } }; } } }
  });
  await module.exports.getWork('work_1', 'provider_2');
  await module.exports.getWork('work_1');
  assert.deepEqual(JSON.parse(JSON.stringify(requests.map(request => request.data))), [
    { action: 'getWork', workId: 'work_1', providerId: 'provider_2' }, { action: 'getWork', workId: 'work_1' }
  ]);
});
test('saved works retain known owner and do not guess an owner for collisions', async t => {
  let url;
  const value = page('me-assets', { navigateTo: options => { url = options.url; } });
  value.type = 'liked'; value.data.navWorkspace = 'buyer';
  t.mock.method(saved, 'listMine', async () => ({ providerIds: [], workIds: ['unique', 'collision'] }));
  t.mock.method(orders, 'listOrders', async () => []);
  t.mock.method(catalog, 'listProviders', async () => ({ providers: [
    { works: [{ id: 'unique', providerId: 'provider_2' }, { id: 'collision', providerId: 'provider_2' }] },
    { works: [{ id: 'collision', providerId: 'provider_3' }] }
  ] }));
  await value.loadCloud();
  assert.equal(value.data.items.length, 1);
  assert.equal(value.data.items[0].providerId, 'provider_2');
  value.openItem({ currentTarget: { dataset: { id: 'unique', kind: 'work' } } });
  assert.equal(url, '/pages/work-detail/index?id=unique&providerId=provider_2');
});

test('referenced works use the order owner and retain same-id works from different authors', async t => {
  let url;
  const value = page('me-assets', { navigateTo: options => { url = options.url; } });
  value.type = 'referenced';
  t.mock.method(saved, 'listMine', async () => ({ providerIds: [], workIds: [] }));
  t.mock.method(orders, 'listOrders', async () => [
    { viewerRole: 'BUYER', providerId: 'one', referenceWorkId: 'shared' },
    { viewerRole: 'BUYER', providerId: 'two', referenceWorkId: 'shared' },
    { viewerRole: 'BUYER', providerId: 'one', referenceWorkId: 'shared' },
    { viewerRole: 'BUYER', providerId: 'missing', referenceWorkId: 'unique' },
    { viewerRole: 'PROVIDER', providerId: 'three', referenceWorkId: 'unique' }
  ]);
  t.mock.method(catalog, 'listProviders', async () => ({ providers: [
    { id: 'one', works: [{ id: 'shared', providerId: 'one', title: 'first' }] },
    { id: 'two', works: [{ id: 'shared', providerId: 'two', title: 'second' }] },
    { id: 'three', works: [{ id: 'unique', providerId: 'three', title: 'not referenced' }] }
  ] }));
  await value.loadCloud();
  assert.equal(value.data.items.length, 2);
  assert.equal(new Set(value.data.items.map(item => item.key)).size, 2);
  value.openItem({ currentTarget: { dataset: { id: 'shared', kind: 'work', providerId: 'two' } } });
  assert.equal(url, '/pages/work-detail/index?id=shared&providerId=two');
  url = null;
  value.openItem({ currentTarget: { dataset: { id: 'shared', kind: 'work' } } });
  assert.equal(url, null);
});

for (const outcome of ['success', 'failure', 'unloaded']) test(`work detail ignores obsolete ${outcome}`, async t => {
  const old = deferred();
  t.mock.method(catalog, 'getWork', id => id === 'old' ? old.promise : Promise.resolve({ work: { id, provider: { id: 'owner' } } }));
  const value = page('work-detail');
  value.renderWork = work => value.setData({ work, loadError: '' });
  value.loadCloudWork({ id: 'old' });
  if (outcome === 'unloaded') value.onUnload();
  else { value.loadCloudWork({ id: 'new' }); await flush(); }
  const before = JSON.stringify(value.data);
  if (outcome === 'failure') old.reject(Error('old failure'));
  else old.resolve({ work: { id: 'old', provider: { id: 'old-owner' } } });
  await flush();
  assert.equal(JSON.stringify(value.data), before);
});

test('provider detail ignores an old availability response after a newer provider loaded', async t => {
  const old = deferred();
  t.mock.method(catalog, 'getProvider', async id => ({ provider: { id, nickname: id } }));
  t.mock.method(availability, 'getPublic', id => id === 'old' ? old.promise : Promise.resolve({}));
  const value = page('provider-detail', { showToast() { assert.fail('stale response must not toast'); } });
  value.loadProvider = (_options, provider) => value.setData({ provider });
  value.loadCloudProvider({}, 'old'); await flush();
  value.loadCloudProvider({}, 'new'); await flush();
  old.resolve({}); await flush();
  assert.equal(value.data.provider.id, 'new');
});

for (const outcome of ['success', 'failure', 'unloaded']) test(`saved listing ignores obsolete ${outcome}`, async t => {
  const old = deferred(); let calls = 0;
  t.mock.method(catalog, 'listProviders', () => ++calls === 1 ? old.promise : Promise.resolve({ providers: [] }));
  t.mock.method(saved, 'listMine', async () => ({ providerIds: ['old'], workIds: [] }));
  t.mock.method(orders, 'listOrders', async () => []);
  const value = page('me-assets'); value.type = 'followed';
  value.loadCloud(); await flush();
  if (outcome === 'unloaded') value.onUnload();
  else await value.loadCloud();
  const before = JSON.stringify(value.data);
  if (outcome === 'failure') old.reject(Error('old failure'));
  else old.resolve({ providers: [{ id: 'old', nickname: 'old' }] });
  await flush();
  assert.equal(JSON.stringify(value.data), before);
});

for (const outcome of ['failure', 'unloaded']) test(`provider detail ignores obsolete ${outcome}`, async t => {
  const old = deferred();
  t.mock.method(catalog, 'getProvider', () => old.promise);
  t.mock.method(availability, 'getPublic', async () => ({}));
  const value = page('provider-detail', { showToast() { assert.fail('no obsolete toast'); } });
  value.loadProvider = () => assert.fail('no obsolete render');
  const pending = value.loadCloudProvider({}, 'old');
  value.onUnload();
  if (outcome === 'failure') old.reject(Error('late'));
  else old.resolve({ provider: { id: 'old' } });
  await pending;
});

test('provider follow waits for known state before changing it', async t => {
  const old = deferred();
  t.mock.method(saved, 'listMine', () => old.promise);
  let writes = 0; t.mock.method(saved, 'setSaved', async () => { writes++; });
  const value = page('provider-detail'); value.data.provider = { id: 'owner' };
  value.onShow(); await value.toggleFollow(); assert.equal(writes, 0);
  old.resolve({ providerIds: [] }); await flush();
  await value.toggleFollow(); assert.equal(writes, 1);
  assert.equal(value.data.followed, true);
});

for (const [route, action] of [['work-detail','toggleFollow'], ['work-detail','toggleLike'], ['provider-detail','toggleFollow']]) {
  for (const outcome of ['success', 'failure']) test(`${route} ${action} ignores ${outcome} after unload`, async t => {
    const pending = deferred();
    t.mock.method(saved, 'setSaved', () => pending.promise);
    const value = page(route, { showToast() { assert.fail('no stale mutation toast'); } });
    value.socialCloudMode = true;
    value.data.work = { id: 'work', provider: { id: 'owner' } }; value.data.provider = { id: 'owner' };
    const actionPromise = value[action](); value.onUnload();
    const before = JSON.stringify(value.data);
    if (outcome === 'success') pending.resolve(); else pending.reject(Error('late failure'));
    await actionPromise;
    assert.equal(JSON.stringify(value.data), before);
  });
}

test('asset list retries the same category after failure and preserves owner navigation',async t=>{
 for(const type of ['followed','liked','referenced']){
  let url,calls=0;const value=page('me-assets',{navigateTo:options=>{url=options.url;}});value.type=type;value.cloudMode=true;
  t.mock.method(saved,'listMine',async()=>({providerIds:['p'],workIds:['w']}));t.mock.method(orders,'listOrders',async()=>[{viewerRole:'BUYER',providerId:'p',referenceWorkId:'w'}]);
  t.mock.method(catalog,'listProviders',async()=>{throw Error('offline');});await value.loadCloud();assert.notEqual(value.data.loadError,'');assert.equal(value.data.loading,false);
  const response=deferred();t.mock.method(catalog,'listProviders',()=>{calls++;return response.promise;});const request=value.retryLoad();value.retryLoad();await flush();assert.equal(calls,1);
  response.resolve({providers:[{id:'p',nickname:'作者',works:[{id:'w',providerId:'p',title:'作品'}]}]});await request;assert.equal(value.data.loadError,'');assert.equal(value.data.items.length,1);assert.equal(value.type,type);
  value.openItem({currentTarget:{dataset:value.data.items[0]}});assert.match(url,type==='followed'?/provider-detail.*id=p/:/work-detail.*id=w&providerId=p/);
  value.onUnload();value.retryLoad();assert.equal(calls,1);
 }
});

test('asset categories do not depend on unrelated orders or saved-item services',async t=>{
 for(const type of ['followed','liked','referenced']){
  const value=page('me-assets');value.type=type;let irrelevant=0;
  t.mock.method(catalog,'listProviders',async()=>({providers:[{id:'p',nickname:'作者',works:[{id:'w',providerId:'p',title:'作品'}]}]}));
  t.mock.method(saved,'listMine',async()=>{if(type==='referenced'){irrelevant++;throw Error('saved unavailable');}return {providerIds:['p'],workIds:['w']};});
  t.mock.method(orders,'listOrders',async()=>{if(type!=='referenced'){irrelevant++;throw Error('orders unavailable');}return [{viewerRole:'BUYER',providerId:'p',referenceWorkId:'w'}];});
  await value.loadCloud();assert.equal(value.data.loadError,'');assert.equal(value.data.items.length,1);assert.equal(irrelevant,0);
 }
});

test('provider detail separates failure and unpublished results and retries original entry',async t=>{
 const value=page('provider-detail');const options={id:'p',workspace:'provider',services:'s'};let readId,loadedOptions;
 t.mock.method(catalog,'getProvider',async()=>{throw Error('offline');});await value.loadCloudProvider(options,'p');assert.equal(value.data.loading,false);assert.notEqual(value.data.loadError,'');
 const wait=deferred();let calls=0;t.mock.method(catalog,'getProvider',id=>{calls++;readId=id;return wait.promise;});const retry=value.retryLoad();value.retryLoad();assert.equal(calls,1);wait.resolve({provider:null});await retry;assert.equal(value.data.provider,null);assert.equal(value.data.loadError,'');assert.equal(value.data.loading,false);assert.equal(readId,'p');
 t.mock.method(catalog,'getProvider',async()=>({provider:{id:'p',nickname:'作者',services:[],works:[]}}));t.mock.method(availability,'getPublic',async()=>({}));value.loadProvider=opts=>{loadedOptions=opts;};await value.retryLoad();assert.equal(loadedOptions.workspace,'provider');assert.equal(loadedOptions.services,'s');assert.equal(value.data.loading,false);
 value.onUnload();value.retryLoad();assert.equal(value.data.loading,false);
});

test('saved-state failure keeps work readable and prevents toggles until retry succeeds',async t=>{
 const value=page('work-detail',{getStorageSync:()=>[]});value.socialCloudMode=true;let mutations=0;
 t.mock.method(catalog,'getWork',async()=>({work:{id:'w',title:'作品',provider:{id:'p',nickname:'作者'},imageUrls:[]}}));t.mock.method(saved,'listMine',async()=>{throw Error('offline');});t.mock.method(saved,'setSaved',async()=>{mutations++;});
 await value.loadCloudWork({id:'w',providerId:'p'});assert.equal(value.data.work.id,'w');assert.equal(value.data.loadError,'');assert.notEqual(value.data.socialLoadError,'');await value.toggleFollow();await value.toggleLike();assert.equal(mutations,0);
 await value.retrySocial();assert.notEqual(value.data.socialLoadError,'');assert.equal(value.data.socialPending,false);
 t.mock.method(saved,'listMine',async()=>({providerIds:['p'],workIds:['w']}));await value.retrySocial();assert.equal(value.data.socialLoadError,'');assert.equal(value.data.followed,true);assert.equal(value.data.liked,true);
});


test('provider follow read failure stays unknown, blocks writes and can retry', async t => {
  t.mock.method(saved, 'listMine', async () => { throw Error('offline'); });
  let writes = 0; t.mock.method(saved, 'setSaved', async () => { writes++; });
  const value = page('provider-detail'); value.data.provider = { id: 'owner' };
  await value.onShow(); assert.match(value.data.socialLoadError, /读取失败/);
  await value.toggleFollow(); assert.equal(writes, 0);
  t.mock.method(saved, 'listMine', async () => ({ providerIds: ['owner'] }));
  await value.retrySocial(); assert.equal(value.data.followed, true); assert.equal(value.data.socialLoadError, ''); assert.equal(value.data.socialPending, false);
  value.onUnload(); await value.retrySocial(); assert.equal(writes, 0);
});


test('empty saved and referenced lists never load the public catalogue', async t => {
 for(const type of ['followed','liked','referenced']){
  const value=page('me-assets');value.type=type;
  t.mock.method(saved,'listMine',async()=>({providerIds:[],workIds:[]}));
  t.mock.method(orders,'listOrders',async()=>[{viewerRole:'PROVIDER',providerId:'p',referenceWorkId:'w'}]);
  t.mock.method(catalog,'listProviders',()=>assert.fail('empty lists must not request catalogue'));
  await value.loadCloud();assert.equal(value.data.items.length,0);assert.equal(value.data.loading,false);assert.equal(value.data.loadError,'');
 }
});
