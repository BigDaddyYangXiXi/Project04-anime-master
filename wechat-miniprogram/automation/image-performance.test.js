const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const filename = require.resolve('../miniprogram/services/cloud-catalog');
function fixture(accountApi) {
  let owner = 'a', now = 1000, urlCalls = 0, reads = 0;
  const wx = {
    getStorageSync: () => ({ id: owner }),
    cloud: {
      callFunction: async () => { reads++; return { result: { ok: true, data: { provider: { works: [], avatarFileId: 'cloud://avatar' } } } }; },
      getTempFileURL: async ({ fileList }) => { urlCalls++; return { fileList: fileList.map(fileID => ({ fileID, status: 0, tempFileURL: 'https://image.test/' + urlCalls })) }; }
    }
  };
  const module = { exports: {} }, realRequire = createRequire(filename);
  new Function('require', 'module', 'wx', 'Date', 'getApp', fs.readFileSync(filename, 'utf8'))(
    name => name === '../config/cloudbase' ? { enabled: true, env: 'test' }
      : name === '../utils/local-preview' ? { assertCloudAllowed() {} } : name === './cloud-account' && accountApi ? accountApi : realRequire(name), module, wx, { now: () => now }, () => ({globalData:{account:owner ? {id:owner} : null}}));
  return { api: module.exports, wx, owner: value => { owner = value; }, advance: ms => { now += ms; }, counts: () => ({ urlCalls, reads }) };
}
test('image URLs reuse for fifteen minutes; business visibility is always reread', async () => {
  const f = fixture();
  await f.api.getProvider(); await f.api.getProvider();
  assert.deepEqual(f.counts(), { urlCalls: 1, reads: 2 });
  f.advance(60001); await f.api.getProvider();
  assert.equal(f.counts().urlCalls, 1);
  f.advance(840000); await f.api.getProvider();
  assert.equal(f.counts().urlCalls, 2);
  f.wx.cloud.callFunction = async () => ({ result: { ok: true, data: { provider: null } } });
  assert.equal((await f.api.getProvider()).provider, null);
});

test('draft and account must belong to the original session before resolving private media', async () => {
  for (const mode of ['normal', 'account', 'draft', 'session']) {
    let finish; const calls = [];
    const f = fixture({ getMine: () => new Promise(resolve => { finish = resolve; }) });
    f.wx.cloud.callFunction = async ({ data }) => {
      calls.push(data.action);
      return { result: { ok: true, data: { providerId: mode === 'draft' ? 'b' : 'a', draft: { profile: {}, works: [], services: [] } } } };
    };
    const pending = f.api.getDraft();
    if (mode === 'session') f.owner('b');
    finish({ id: mode === 'account' ? 'b' : 'a', nickname: '作者' });
    if (mode === 'normal') assert.equal((await pending).clientDraft.profile.nickname, '作者');
    else await assert.rejects(pending, { code: 'ACCOUNT_CHANGED' });
    assert.deepEqual(calls, ['getDraft']);
  }
});

test('account changes stop image upload at each boundary and never cancel using the new account', async () => {
  const stages = ['metadata', 'prepareUpload', 'transfer', 'commitUpload', 'submitImage', 'review-failure'];
  for (const stage of stages) {
    const f = fixture(), calls = [];
    f.wx.getImageInfo = ({ success }) => { if (stage === 'metadata') f.owner('b'); success({ type: 'png' }); };
    f.wx.cloud.uploadFile = async () => { calls.push('transfer'); if (stage === 'transfer') f.owner('b'); return { fileID: 'cloud://file' }; };
    f.wx.cloud.callFunction = async ({ data }) => {
      calls.push(data.action);
      if (data.action === stage || stage === 'review-failure' && data.action === 'submitImage') f.owner('b');
      if (stage === 'review-failure' && data.action === 'submitImage') throw Error('lost response');
      return { result: { ok: true, data: { assetId: 'asset', cloudPath: 'path', status: 'READY' } } };
    };
    await assert.rejects(f.api.uploadImage({ tempFilePath: '/image.png', size: 100 }, 'WORK_IMAGE'), { code: 'ACCOUNT_CHANGED' });
    const expected = ['prepareUpload', 'transfer', 'commitUpload', 'submitImage'];
    assert.deepEqual(calls, stage === 'metadata' ? [] : expected.slice(0, stage === 'review-failure' ? 4 : expected.indexOf(stage) + 1), stage);
  }
});

test('workbench overview skips image resolution while public detail retains it', async () => {
  const f = fixture();
  const overview = await f.api.getProvider('provider', { images: false });
  assert.ok(overview.provider);
  assert.deepEqual(f.counts(), { reads: 1, urlCalls: 0 });
  assert.ok((await f.api.getProvider('provider')).provider.avatarUrl);
  assert.deepEqual(f.counts(), { reads: 2, urlCalls: 1 });
});
test('identical concurrent URL requests coalesce; failed requests are retried', async () => {
  const f = fixture();
  await Promise.all([f.api.getProvider(), f.api.getProvider()]);
  assert.equal(f.counts().urlCalls, 1);
  f.api.clearImageCache();
  const original = f.wx.cloud.getTempFileURL;
  f.wx.cloud.getTempFileURL = async () => { throw Error('offline'); };
  await assert.rejects(f.api.getProvider(), /offline/);
  f.wx.cloud.getTempFileURL = original;
  assert.ok((await f.api.getProvider()).provider.avatarUrl);
});

test('discovery resolves only covers, preserves counts, and detail resolves the full gallery', async () => {
  const f = fixture(), requested = [];
  const work = { id: 'work', imageFileIds: ['cloud://cover', 'cloud://second', 'cloud://third'] };
  const provider = { id: 'provider', avatarFileId: 'cloud://avatar', works: [work] };
  f.wx.cloud.callFunction = async ({ data }) => ({ result: { ok: true, data: data.action === 'listDiscovery'
    ? { providers: [provider] } : { work: { ...work, provider } } } });
  f.wx.cloud.getTempFileURL = async ({ fileList }) => { requested.push(fileList); return { fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://image.test/' + fileID })) }; };
  const list = await f.api.listDiscovery({});
  assert.deepEqual(requested[0], ['cloud://avatar', 'cloud://cover']);
  const mapped = require('../miniprogram/data/cloud-public-catalog').mapCloudCatalog(list.providers);
  assert.equal(mapped.works[0].imageCount, 3);
  assert.equal(mapped.works[0].imagePreviews.length, 1);
  const detail = await f.api.getWork('work', 'provider');
  assert.equal(detail.work.imageUrls.length, 3);
  assert.deepEqual(requested[1], ['cloud://second', 'cloud://third']);
});
test('switching accounts and logout reject old in-flight responses, including return to same account', async () => {
  const f = fixture();
  let finish;
  f.wx.cloud.getTempFileURL = () => new Promise(resolve => { finish = resolve; });
  const pending = f.api.getProvider();
  await new Promise(setImmediate);
  f.api.clearImageCache(); f.owner('b'); f.owner('a');
  finish({ fileList: [{ fileID: 'cloud://avatar', tempFileURL: 'https://old.test/' }] });
  await assert.rejects(pending, /账号已切换/);
});
async function upload({ size = 2000000, type = 'jpeg', compressedSize = 700000, purpose = 'WORK_IMAGE', fail = false } = {}) {
  const f = fixture(), calls = [], files = [];
  let compressions = 0;
  f.wx.getImageInfo = ({ success }) => success({ type });
  f.wx.getFileInfo = ({ success }) => success({ size: compressedSize });
  f.wx.compressImage = ({ quality, success, fail: reject }) => { compressions++; assert.equal(quality, 85); fail ? reject(Error('unsupported')) : success({ tempFilePath: '/compressed.jpg' }); };
  f.wx.cloud.callFunction = async ({ data }) => { calls.push(data); return { result: { ok: true, data: { assetId: 'asset', cloudPath: 'path', status: 'PENDING_SECURITY_REVIEW' } } }; };
  f.wx.cloud.uploadFile = async ({ filePath }) => { files.push(filePath); return { fileID: 'cloud://uploaded' }; };
  await f.api.uploadImage({ tempFilePath: '/original.jpg', size }, purpose);
  return { compressions, calls, files };
}
test('large JPEG uses measured compressed bytes and path through normal commit and review', async () => {
  const r = await upload();
  assert.equal(r.compressions, 1); assert.equal(r.calls[0].sizeBytes, 700000);
  assert.deepEqual(r.files, ['/compressed.jpg']);
  assert.deepEqual(r.calls.map(c => c.action), ['prepareUpload', 'commitUpload', 'submitImage']);
});
test('small avatars, PNG, WebP and delivery originals avoid compression entirely', async () => {
  for (const options of [{ size: 8686, purpose: 'AVATAR' }, { type: 'png' }, { type: 'webp' }, { purpose: 'ORDER_DELIVERY' }]) {
    const r = await upload(options); assert.equal(r.compressions, 0); assert.deepEqual(r.files, ['/original.jpg']);
  }
});
test('failed or ineffective compression uses original bytes and path', async () => {
  for (const options of [{ fail: true }, { compressedSize: 2100000 }, { compressedSize: 1950000 }, { compressedSize: 0 }]) {
    const r = await upload(options); assert.equal(r.calls[0].sizeBytes, 2000000); assert.deepEqual(r.files, ['/original.jpg']);
  }
});

test('local timing records are bounded, contain no request data, and mark failures', async () => {
  const metrics = require('../miniprogram/utils/image-performance');
  metrics.clear();
  for (let i = 0; i < 105; i++) await metrics.measure('imageTransfer', async () => ({ secret: 'never retain' }));
  await assert.rejects(metrics.measure('profileSave', async () => { throw Error('private error'); }));
  const records = metrics.read();
  assert.equal(records.length, 100); assert.equal(records.at(-1).ok, false);
  for (const record of records) assert.deepEqual(Object.keys(record), ['stage', 'milliseconds', 'ok']);
  records[0].stage = 'changed'; assert.equal(metrics.read()[0].stage, 'imageTransfer');
  metrics.clear(); assert.equal(metrics.read().length, 0);
});
