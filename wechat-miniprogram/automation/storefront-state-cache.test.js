const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');

function fixture({ mediaStatus = 'READY', banner = false, intentStatus = null } = {}) {
  let owner = 'one', now = 1000, displayRevision = 0, failSave = false;
  const calls = [], filename = require.resolve('../miniprogram/services/cloud-catalog'), actual = createRequire(filename), module = { exports: {} };
  const wx = { getStorageSync: () => ({ id: owner }), cloud: { callFunction: async ({ data }) => {
    calls.push(data.action);
    if (data.action === 'getOwnedMedia') return {result:{ok:true,data:{assets:[{assetId:'banner',status:mediaStatus},{assetId:'source',status:mediaStatus}]}}};
    if (data.action === 'getProvider') return {result:{ok:true,data:{provider:null}}};
    if (data.action === 'saveDraft' && failSave) throw Error('offline');
    return { result: { ok: true, data: { providerId: owner, version: 1, contentIntent: intentStatus ? {status:intentStatus} : null, draft: { profile: banner ? {bannerAssetId:'banner',bannerSourceAssetId:'source'} : {}, works: [], services: [] } } } };
  } } };
  new Function('require', 'module', 'wx', 'Date', 'getApp', fs.readFileSync(filename, 'utf8'))(name =>
    name === '../config/cloudbase' ? { enabled: true, env: 'test' }
      : name === '../utils/local-preview' ? { assertCloudAllowed() {} }
      : name === '../utils/display-cache' ? { owner: () => owner, revision: () => displayRevision, clear: () => displayRevision++ }
      : name === './cloud-account' ? { getMine: async () => ({ id: owner, nickname: 'name' }), peekMine: () => ({id:owner,nickname:'name'}) } : actual(name), module, wx, { now: () => now }, () => ({globalData:{account:owner ? {id:owner} : null}}));
  return { api: module.exports, calls, owner: value => { owner = value; }, advance: value => { now += value; }, invalidate: () => displayRevision++, failSave: () => { failSave = true; } };
}

test('稳定头图可复用，待检测媒体或待发布任务不能被冻结在草稿缓存', async () => {
  for(const [mediaStatus,intentStatus,expected] of [['READY',null,1],['PENDING_SECURITY_REVIEW',null,2],['READY','PENDING',2]]) {
    const f=fixture({banner:true,mediaStatus,intentStatus});await f.api.getDraft();await f.api.getDraft();
    assert.equal(f.calls.filter(x=>x==='getDraft').length,expected);
  }
});

test('returning to an unchanged storefront reuses an isolated draft; expiry, identity and writes invalidate it', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.api.getDraft(), f.api.getDraft()]);
  assert.equal(f.calls.length, 1);
  a.clientDraft.profile.bio = 'unsaved';
  assert.equal(b.clientDraft.profile.bio, '');
  assert.equal(f.api.peekDraft().clientDraft.profile.bio, '');
  await f.api.getDraft(); assert.equal(f.calls.length, 1);
  await f.api.saveDraft(1, b.clientDraft);
  assert.equal(f.api.peekDraft(), null);
  await f.api.getDraft(); assert.equal(f.calls.filter(x => x === 'getDraft').length, 2);
  f.advance(900000); assert.equal(f.api.peekDraft(), null); await f.api.getDraft();
  f.owner('two'); assert.equal(f.api.peekDraft(), null); await f.api.getDraft();
  f.invalidate(); assert.equal(f.api.peekDraft(), null); await f.api.getDraft();
  f.failSave(); await assert.rejects(f.api.saveDraft(1, b.clientDraft), /offline/);
  assert.equal(f.api.peekDraft(), null);
  await f.api.getDraft(); f.api.clearDraftCache(); assert.equal(f.api.peekDraft(), null);
});


test('server-confirmed absent storefront opens locally and skips all own public catalogue reads', async () => {
  const f=fixture(); f.api.seedSession({account:{id:'one'},storefrontState:{draftVersion:0,hasPublication:false}});
  assert.equal(f.api.peekDraft().version,0);
  const a=await f.api.getDraft(); a.clientDraft.profile.bio='unsaved';
  assert.equal((await f.api.getDraft()).clientDraft.profile.bio,'');
  assert.deepEqual(await f.api.getProvider('one',{images:false}),{provider:null});
  await f.api.getProvider('one');
  assert.equal(f.calls.length,0);
  await f.api.getProvider('other',{images:false}); assert.equal(f.calls.length,1);
  f.advance(900000); assert.equal(f.api.peekDraft(),null);
  await f.api.getDraft(); await f.api.getProvider('one',{images:false}); assert.equal(f.calls.length,3);
});
test('unknown metadata never means empty; existing unpublished drafts read once and cache', async () => {
  for(const state of [undefined,null,{draftVersion:2,hasPublication:false}]){
    const f=fixture(); f.api.seedSession({account:{id:'one'},storefrontState:state});
    assert.equal(f.api.peekDraft(),null); await f.api.getDraft(); await f.api.getDraft();
    assert.equal(f.calls.filter(x=>x==='getDraft').length,1);
  }
});
test('first save, failed save, publishing, logout and account switches cannot keep an empty marker', async () => {
  for(const action of ['save','failed-save','publish','logout','switch']){
    const f=fixture();f.api.seedSession({account:{id:'one'},storefrontState:{draftVersion:0,hasPublication:false}});
    const value=(await f.api.getDraft()).clientDraft;
    if(action==='save') await f.api.saveDraft(0,value);
    if(action==='failed-save'){f.failSave();await assert.rejects(f.api.saveDraft(0,value));}
    if(action==='publish') await f.api.publishDraft(1);
    if(action==='logout') f.api.clearStorefrontState();
    if(action==='switch') f.owner('two');
    assert.equal(f.api.peekDraft(),null,action); await f.api.getDraft();
    assert.equal(f.calls.filter(x=>x==='getDraft').length,1,action);
  }
});
test('own public summary coalesces concurrent reads and caches null across workbench and personal page',async()=>{
 const f=fixture();await Promise.all([f.api.getProvider('one',{images:false}),f.api.getProvider('one',{images:false})]);
 await f.api.getProvider('one',{images:false});assert.equal(f.calls.length,1);
 f.invalidate();await f.api.getProvider('one',{images:false});assert.equal(f.calls.length,2);
 f.advance(900000);await f.api.getProvider('one',{images:false});assert.equal(f.calls.length,3);
});


test('expired empty state can warm the real draft before editor entry, and navigation reuses it', async () => {
 const f=fixture();f.api.seedSession({account:{id:'one'},storefrontState:{draftVersion:0,hasPublication:false}});
 f.advance(900001);assert.equal(f.api.peekDraft(),null);
 const background=f.api.getDraft(),foreground=f.api.getDraft();
 await Promise.all([background,foreground]);
 assert.equal(f.calls.filter(x=>x==='getDraft').length,1);
 assert.ok(f.api.peekDraft());await f.api.getDraft();assert.equal(f.calls.filter(x=>x==='getDraft').length,1);
});

test('background draft preparation reads no media and skips a server-confirmed empty storefront', async () => {
 const f=fixture();
 await f.api.prefetchDraft();
 assert.deepEqual(f.calls,['getDraft']);
 assert.equal(f.api.peekDraft(),null);
 f.api.seedSession({account:{id:'one'},storefrontState:{draftVersion:0,hasPublication:false}});
 await f.api.prefetchDraft();
 assert.deepEqual(f.calls,['getDraft']);
});
