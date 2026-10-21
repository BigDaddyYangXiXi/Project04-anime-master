const test=require('node:test'),assert=require('node:assert/strict');
const cache=require('../miniprogram/utils/display-cache');
let owner,storage;
test.beforeEach(()=>{owner='a';storage=new Map();global.getApp=()=>({globalData:{account:owner?{id:owner}:null}});global.wx={getStorageInfoSync:()=>({currentSize:0,limitSize:10240}),getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),removeStorageSync:k=>storage.delete(k)};});
test('display cache is scoped, expires, bounded and never restores an unverified owner',()=>{
 cache.write('me:buyer',{nickname:'A'});assert.equal(cache.read('me:buyer').nickname,'A');assert.equal(cache.read('me:provider'),null);owner='b';assert.equal(cache.read('me:buyer'),null);cache.write('late',{secret:true},'a');assert.equal(cache.read('late'),null);owner=null;assert.equal(cache.read('me:buyer'),null);owner='a';const entry=[...storage.values()][0][0];entry.at-=300001;assert.equal(cache.read('me:buyer'),null);for(let i=0;i<10;i++)cache.write('d'+i,{i});assert.equal([...storage.values()][0].length,6);cache.clear();assert.equal(storage.size,0);
});
test('cache storage failure does not fail page reads',()=>{wx.setStorageSync=()=>{throw Error('full')};wx.getStorageSync=()=>{throw Error('unavailable')};cache.write('x',{});assert.equal(cache.read('x'),null);});

test('UTF-8 size bounds individual Chinese snapshots and the complete storage key',()=>{
 const {bytes}=require('../miniprogram/utils/cache-size');
 for(const value of ['abc','中文','😀','\ud800',{text:'中文😀'}])
  assert.equal(bytes(value),Buffer.byteLength(JSON.stringify(value),'utf8'));
 cache.write('large',{text:'中'.repeat(50000)});
 assert.equal(cache.read('large'),null);
 for(let i=0;i<6;i++)cache.write('page'+i,{text:'中'.repeat(40000)});
 assert.ok(bytes([...storage.values()][0])<=512*1024);
 assert.equal(cache.read('page0'),null);
 assert.ok(cache.read('page5'));
});

test('low or unknown storage quota skips optional snapshots without deleting unfinished user actions',()=>{
 storage.set('refund-pending',{requestId:'must-keep'});
 for(const info of [{currentSize:9400,limitSize:10240},{currentSize:0,limitSize:512},{currentSize:NaN,limitSize:10240}]){
  wx.getStorageInfoSync=()=>info;cache.write('x',{value:1});assert.equal(cache.read('x'),null);
 }
 wx.getStorageInfoSync=()=>{throw Error('quota unavailable');};
 assert.doesNotThrow(()=>cache.write('x',{value:1}));
 assert.deepEqual(storage.get('refund-pending'),{requestId:'must-keep'});
 delete wx.getStorageInfoSync;cache.write('x',{value:1});assert.equal(cache.read('x'),null);
});
test('personal center paints cached stats before a slow response and replaces them after success',async t=>{
 let def;global.Page=p=>def=p;require('../miniprogram/pages/me/index');delete global.Page;
 const account=require('../miniprogram/services/cloud-account'),orders=require('../miniprogram/services/cloud-orders'),saved=require('../miniprogram/services/cloud-saved-items');
 cache.write('me:buyer:v4',{buyerHighlights:[{key:'orders',label:'发起合作',value:9}],account:{nickname:'cached',avatar:'https://example.test/cached-avatar.png'},initial:'c',buyerStats:[{label:'历史合作',value:7}],providerStats:[],assets:[],previewMeta:'',storefrontStatusText:''});
 t.mock.method(account,'peekMine',()=>({id:'a',nickname:'session'}));t.mock.method(account,'getMine',async()=>({id:'a',nickname:'fresh'}));let finish;t.mock.method(orders,'listOrders',()=>new Promise(r=>finish=r));t.mock.method(saved,'listMine',async()=>({providerIds:[],workIds:[]}));
 const p={...def,data:structuredClone(def.data),setData(v){Object.assign(this.data,v)}};const start=performance.now(),request=p.loadCloudDashboard('buyer');assert.equal(p.data.buyerStats[0].value,7);assert.equal(p.data.dashboardCached,true);assert.equal(p.data.account.avatar,'https://example.test/cached-avatar.png');assert.equal(p.data.account.nickname,'cached');assert.ok(performance.now()-start<1000);finish([]);await request;assert.equal(p.data.buyerStats[0].value,0);assert.equal(p.data.dashboardCached,false);
});
test('discovery restores exact-query cached first page before network, preserves it on failure',async t=>{
 const catalog=require('../miniprogram/services/cloud-catalog'),{serverFilters}=require('../miniprogram/utils/discovery-query'),{loadDiscoveryPage}=require('../miniprogram/utils/discovery-pagination');
 const data={career:'妆娘',date:'2026-10-04',searchQuery:'',selectedFilters:[],cityCode:'330100',city:'杭州',mode:'works'};
 cache.write('discovery:'+JSON.stringify({...serverFilters(data.cityCode,data.career,data.date,'',[]),pageUnit:'work',mode:'works'}),{providers:[],nextCursor:'old'});
 let reject;t.mock.method(catalog,'listDiscovery',()=>new Promise((_,r)=>reject=r));let paints=0;const p={data,setData(v,cb){Object.assign(this.data,v);if(cb)cb()},refreshResults(){paints++}};const start=performance.now(),pending=loadDiscoveryPage(p);assert.equal(p.data.catalogCached,true);assert.equal(p.data.catalogLoading,false);assert.equal(p.data.catalogNextCursor,null);assert.ok(paints>0);assert.ok(performance.now()-start<1000);reject(Error('offline'));await pending;assert.equal(p.data.catalogError,'');assert.match(p.data.catalogCacheError,/失败/);
});

test('an invalidated in-flight read cannot repopulate a saved profile or published catalog cache',()=>{
 const revision=cache.revision();cache.write('me:buyer',{nickname:'old'});cache.clear();cache.write('me:buyer',{nickname:'late old'},'a',revision);assert.equal(cache.read('me:buyer'),null);cache.write('me:buyer',{nickname:'new'},'a',cache.revision());assert.equal(cache.read('me:buyer').nickname,'new');
});
test('successful account save and publication invalidate display snapshots; failure preserves them',async()=>{
 const fs=require('node:fs'),{createRequire}=require('node:module');
 for(const service of ['cloud-account','cloud-catalog'])for(const success of [false,true]){
  const filename=require.resolve('../miniprogram/services/'+service),actual=createRequire(filename),module={exports:{}};
  wx.cloud={callFunction:async()=>({result:success?{ok:true,data:{id:'a',nickname:'updated',version:2}}:{ok:false,error:{code:'TEST_FAILURE'}}})};
  new Function('require','module','wx',fs.readFileSync(filename,'utf8'))(name=>name==='../config/cloudbase'?{enabled:true,env:'test'}:name==='../utils/local-preview'?{assertCloudAllowed(){}}:actual(name),module,wx);
  cache.write('me:buyer',{nickname:'old'});const revision=cache.revision();
  const request=service==='cloud-account'?module.exports.updateMine(1,'updated',null):module.exports.publishDraft(1);
  if(success){await request;assert.equal(cache.read('me:buyer'),null);assert.ok(cache.revision()>revision);}else{await assert.rejects(request);assert.equal(cache.read('me:buyer').nickname,'old');assert.equal(cache.revision(),revision);}
 }
});
