const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  let now = 1000;
  const app = { globalData: { account: { id: 'a' } } }, calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/utils/read-cache'), 'utf8'), { module, require: name => require('../miniprogram/utils/' + name.replace('./', '')), getApp: () => app, Date: { now: () => now } });
  function read(name = 'project-api', action = 'listProjects', args = {}) {
    return module.exports.run({ name, data: { action, ...args } }, () => new Promise((resolve, reject) => calls.push({ resolve: data => resolve({ result: { ok: true, data } }), reject })));
  }
  return { api: module.exports, app, calls, read, advance: n => { now += n; } };
}
const tick = () => Promise.resolve();
test('three page entries share one request; copies, expiry and query variants stay independent', async () => {
  const f = fixture(), a = f.read(), b = f.read(); await tick();
  assert.equal(f.calls.length, 1); f.calls[0].resolve({ projects: [] });
  const one = await a, two = await b; one.result.data.projects.push('edit');
  assert.equal(two.result.data.projects.length, 0);
  await f.read(); assert.equal(f.calls.length, 1);
  f.advance(300001); const expired = f.read(); await tick(); f.calls[1].resolve({}); await expired;
  const variant = f.read('project-api', 'getProject', { projectId: 'b' }); await tick(); assert.equal(f.calls.length, 3); f.calls[2].resolve({}); await variant;
});
test('mutation invalidates related lists at start and completion, including late pre-write reads', async () => {
  const f = fixture(), old = f.read(); await tick();
  const write = f.read('order-api', 'transitionOrder'); await tick();
  f.calls[1].resolve({}); await write; f.calls[0].resolve({ old: true }); await old;
  const fresh = f.read(); await tick(); assert.equal(f.calls.length, 3); f.calls[2].resolve({ fresh: true }); await fresh;
  const unrelated = f.read('support-api', 'create'); await tick(); f.calls[3].resolve({}); await unrelated;
  assert.equal((await f.read()).result.data.fresh, true); assert.equal(f.calls.length, 4);
});
test('account switches, logout, failed reads and uncertain writes cannot poison a new session', async () => {
  const f = fixture(), old = f.read(); await tick(); f.app.globalData.account.id = 'b';
  const other = f.read(); await tick(); f.calls[0].resolve({ secret: true }); await old;
  f.calls[1].reject(Error('offline')); await assert.rejects(other);
  const retry = f.read(); await tick(); f.calls[2].resolve({}); await retry;
  f.api.clear(); const login = f.read(); await tick(); f.calls[3].resolve({}); await login;
  const write = f.read('project-api', 'saveProject'); await tick(); f.calls[4].reject(Error('unknown')); await assert.rejects(write);
  const reload = f.read(); await tick(); assert.equal(f.calls.length, 6); f.calls[5].resolve({}); await reload;
});
test('all declared read policies reuse results; payment, refund and execution details always read live', async () => {
  const f = fixture();
  for (const [name, actions] of Object.entries(f.api.policies)) for (const action of Object.keys(actions)) {
    const before = f.calls.length, p = f.read(name, action); await tick(); f.calls[before].resolve({}); await p;
    await f.read(name, action); assert.equal(f.calls.length, before + 1, name + ':' + action);
  }
  for (const [name, action] of [['order-api','getOrder'], ['order-api','getProviderFunds'], ['payment-api','getRefund'], ['payment-api','refreshPayment']]) {
    for (let n = 0; n < 2; n++) { const before = f.calls.length, p = f.read(name, action); await tick(); assert.equal(f.calls.length, before + 1); f.calls[before].resolve({}); await p; }
  }
});
test('real project service revisits reuse list, detail and image reads, then saving reloads them', async () => {
  const f = fixture(), calls = [], service = { exports: {} };
  const wx = { cloud: { callFunction() {} } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/cloud-projects'), 'utf8'), {
    module: service, wx,
    require: name => name.includes('cloud-call') ? { call: (_, options) => f.api.run(options, async () => {
      calls.push(options.data.action);
      const action = options.data.action;
      return { result: { ok: true, data: action === 'listProjects' ? { projects: [{ id: 'p' }] }
        : action === 'getTargetImages' ? { images: [{ assetId: 'img', url: 'signed' }] }
        : { id: 'p', targetImages: [{ assetId: 'img' }] } } };
    }) } : name.includes('local-preview') ? { assertCloudAllowed() {} } : { enabled: true, env: 'test' }
  });
  for (let i = 0; i < 3; i++) { await service.exports.listProjects(); await service.exports.getProject('p'); }
  assert.deepEqual(calls, ['listProjects', 'getProject', 'getTargetImages']);
  await service.exports.saveProject('p', 1, {});
  await service.exports.listProjects(); await service.exports.getProject('p');
  assert.deepEqual(calls.slice(3), ['saveProject', 'listProjects', 'getProject', 'getTargetImages']);
});
test('server failures are never cached and a read during a write is invalidated when the write finishes', async () => {
  const f = fixture(); let count = 0;
  const options = { name: 'project-api', data: { action: 'listProjects' } };
  const fail = async () => { count++; return { result: { ok: false } }; };
  await f.api.run(options, fail); await f.api.run(options, fail); assert.equal(count, 2);
  const write = f.read('project-api', 'saveProject'), during = f.read();
  f.calls[1].resolve({ old: true }); await during;
  f.calls[0].resolve({}); await write;
  const after = f.read(); assert.equal(f.calls.length, 3); f.calls[2].resolve({ new: true }); await after;
});

test('prefetched draft text merges with foreground reads but saving invalidates it; media status is never cached', async () => {
 const f=fixture();
 const options={name:'provider-catalog-draft',data:{action:'getDraft'}};
 let reads=0;
 const fetch=async()=>({result:{ok:true,data:{version:++reads,draft:{works:[{imageAssetIds:['pending-image']}]}}}});
 const [a,b]=await Promise.all([f.api.run(options,fetch),f.api.run(options,fetch)]);
 assert.equal(reads,1);assert.equal(a.result.data.version,b.result.data.version);
 await f.api.run({name:'provider-catalog-draft',data:{action:'saveDraft'}},async()=>({result:{ok:true}}));
 assert.equal((await f.api.run(options,fetch)).result.data.version,2);
 let mediaReads=0;
 const media={name:'media-upload',data:{action:'getOwnedMedia',assetIds:['pending-image']}};
 for(let i=0;i<2;i++)await f.api.run(media,async()=>{mediaReads++;return {result:{ok:true,data:{assets:[]}}};});
 assert.equal(mediaReads,2);
});

test('oversized responses still reach callers but are not retained; total byte budget evicts least recently used reads',async()=>{
 const f=fixture();let requests=0;
 const options=id=>({name:'project-api',data:{action:'getProject',projectId:id}});
 const fetch=text=>async()=>{requests++;return {result:{ok:true,data:{text}}};};
 const large=fetch('中'.repeat(100000));
 await f.api.run(options('large'),large);await f.api.run(options('large'),large);
 assert.equal(requests,2);
 const normal=fetch('x'.repeat(220000));
 for(let i=0;i<9;i++)await f.api.run(options(String(i)),normal);
 await f.api.run(options('0'),normal);assert.equal(requests,11);
 await f.api.run(options('9'),normal);assert.equal(requests,12);
 await f.api.run(options('0'),normal);assert.equal(requests,12);
 await f.api.run(options('1'),normal);assert.equal(requests,13);
});
