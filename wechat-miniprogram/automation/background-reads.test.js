const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
 const app = { sessionRevision: 1, globalData: { account: { id: 'a' } } };
 const calls = [], timers = new Map(); let now = 0, seq = 0, busy = false;
 const modules = {
  '../utils/cloud-call': { isBusy: () => busy, call: async (_, options) => { calls.push(options.data.action); return {}; } },
  './cloud-projects': { isAvailable: () => true, listProjects: async () => { calls.push('projects'); return [{id:'old',updatedAt:1},{id:'latest',updatedAt:2}]; } },
  './cloud-account': { getMine: async () => calls.push('account') },
  './cloud-saved-items': { listMine: async () => calls.push('saved') },
  './cloud-orders': { listOrders: async () => calls.push('orders') },
  './cloud-catalog': { peekStorefrontState: () => null, peekDraft: () => null, prefetchDraft: async () => { calls.push('draft'); return {}; }, getProvider: async (owner, options) => { assert.equal(options.images,false); calls.push('provider:'+owner); } }
 };
 const context={module:{exports:{}},require:n=>modules[n],getApp:()=>app,wx:{getNetworkType: ({success}) => success({networkType:'wifi'})},Date:{now:()=>now},setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/background-reads'),'utf8'),context);
 return { api:context.module.exports,app,calls,modules,timers,network:v=>context.wx.getNetworkType=({success})=>success({networkType:v}),busy:v=>busy=v,time:v=>now=v,
  async tick(){const [id,fn]=timers.entries().next().value||[];if(fn){timers.delete(id);await fn();}} };
}
test('buyer warms both roles serially without project detail or images',async()=>{
 const f=fixture();let requested;
 f.modules['../utils/cloud-call'].call=async(_,o)=>{requested=o;f.calls.push('getProject');};
 f.api.schedule('buyer');assert.deepEqual(f.calls,[]);assert.equal(f.timers.size,1);
 for(let i=0;i<6;i++)await f.tick();
 assert.deepEqual(f.calls,['projects','orders','draft','provider:a','account','saved']);assert.equal(requested,undefined);assert.equal(f.timers.size,0);
 f.api.schedule('buyer');assert.equal(f.timers.size,0);
});
test('foreground cloud calls and location take priority; busy waiting is bounded',async()=>{
 const f=fixture();f.busy(true);f.api.schedule('buyer');await f.tick();assert.deepEqual(f.calls,[]);
 f.busy(false);f.app.discoveryLocationReady=Promise.resolve();await f.tick();assert.deepEqual(f.calls,[]);
 f.app.discoveryLocationReady=null;await f.tick();assert.deepEqual(f.calls,['projects']);
 f.busy(true);f.time(16000);await f.tick();assert.equal(f.timers.size,0);
});
test('background, logout and same-id renewed session prevent queued reads',async()=>{
 for(const change of [f=>{f.app.globalData.background=true;},f=>{f.app.globalData.account=null;},f=>{f.app.sessionRevision++;}]){
  const f=fixture();f.api.schedule('buyer');change(f);await f.tick();assert.deepEqual(f.calls,[]);assert.equal(f.timers.size,0);
 }
});
test('failed optional read is silent; remaining jobs still run without retrying it',async()=>{
 const f=fixture();f.modules['./cloud-projects'].listProjects=async()=>{f.calls.push('failed-projects');throw Error('offline');};
 f.api.schedule('buyer');for(let i=0;i<6;i++)await f.tick();
 assert.deepEqual(f.calls,['failed-projects','orders','draft','provider:a','account','saved']);assert.equal(f.timers.size,0);
});
test('provider warms editor draft before own public summary and shared reads',async()=>{
 const f=fixture();f.api.schedule('provider');for(let i=0;i<6;i++)await f.tick();
 assert.deepEqual(f.calls,['draft','provider:a','orders','projects','account','saved']);
});
test('duplicate scheduling coalesces, account changes discard delayed project followups',async()=>{
 const f=fixture();let finish;f.modules['./cloud-projects'].listProjects=()=>new Promise(r=>finish=r);
 f.api.schedule('buyer');f.api.schedule('buyer');assert.equal(f.timers.size,1);
 const wait=f.tick();await Promise.resolve();await Promise.resolve();f.app.globalData.account={id:'b'};finish([{id:'old-owner-project'}]);await wait;
 assert.equal(f.timers.size,0);assert.deepEqual(f.calls,[]);
 f.api.schedule('provider');f.api.clearCache();assert.equal(f.timers.size,0);
});

test('prefetched project list shares the real cache; detail remains demand-loaded and writes invalidate both',async()=>{
 const f=fixture(), cloudCall=require('../miniprogram/utils/cloud-call');
 const previous=global.getApp;global.getApp=()=>f.app;cloudCall.clear();let requests=0;
 const wxApi={cloud:{callFunction:async options=>{
  requests++;
  const data=options.data.action==='listProjects'?{projects:[{id:'p',updatedAt:1}]}:{id:'p'};
  return {result:{ok:true,data}};
 }}};
 const list={name:'project-api',data:{action:'listProjects'}}, detail={name:'project-api',data:{action:'getProject',projectId:'p'}};
 f.modules['./cloud-projects'].listProjects=async()=> (await cloudCall.call(wxApi,list)).result.data.projects;
 f.modules['../utils/cloud-call'].call=(_,o)=>cloudCall.call(wxApi,o);
 try {
  f.api.schedule('buyer');await f.tick();assert.equal(requests,1);
  await cloudCall.call(wxApi,list);await cloudCall.call(wxApi,detail);assert.equal(requests,2);
  await cloudCall.call(wxApi,{name:'project-api',data:{action:'saveProject',projectId:'p'}});
  await cloudCall.call(wxApi,list);await cloudCall.call(wxApi,detail);assert.equal(requests,5);
 } finally {f.api.clearCache();cloudCall.clear();if(previous)global.getApp=previous;else delete global.getApp;}
});

test('unpublished saved storefront makes buyer entry provider-first without changing selected role',async()=>{
 const f=fixture();
 f.modules['./cloud-catalog'].peekStorefrontState=()=>({draftVersion:1,hasPublication:false});
 f.api.schedule('buyer');for(let i=0;i<6;i++)await f.tick();
 assert.deepEqual(f.calls,['draft','provider:a','orders','projects','account','saved']);
 f.api.schedule('provider');assert.equal(f.timers.size,0);
});

test('pending dual-role work is not restarted when switching pages or roles',async()=>{
 const f=fixture();f.api.schedule('buyer');await f.tick();
 f.api.schedule('provider');for(let i=0;i<6;i++)await f.tick();
 assert.deepEqual(f.calls,['projects','orders','draft','provider:a','account','saved']);
});

test('offline, slow and unknown networks do not start optional reads; network degradation stops remaining work',async()=>{
 for(const network of ['none','2g','3g','unknown']){
  const f=fixture();f.network(network);f.api.schedule('buyer');await f.tick();
  assert.deepEqual(f.calls,[]);assert.equal(f.timers.size,0);
 }
 const f=fixture();f.api.schedule('provider');await f.tick();f.network('2g');await f.tick();
 assert.deepEqual(f.calls,['draft']);assert.equal(f.timers.size,0);
});
