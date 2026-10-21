const test=require('node:test'),assert=require('node:assert/strict');
global.getApp=()=>({globalData:{account:{id:'real'}}});
let definition;global.Page=p=>{definition=p;};require('../miniprogram/pages/me/index');delete global.Page;
const account=require('../miniprogram/services/cloud-account'),orders=require('../miniprogram/services/cloud-orders'),catalog=require('../miniprogram/services/cloud-catalog'),saved=require('../miniprogram/services/cloud-saved-items');
function page(){return {...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};}
test('personal center retry preserves role, shares pending retry and recovers real data',async t=>{
 const p=page();p.data.role='provider';let calls=0,finish;
 t.mock.method(account,'peekMine',()=>null);t.mock.method(account,'getMine',async()=>({id:'real',nickname:'测试',username:'Kehaar'}));t.mock.method(catalog,'getProvider',async()=>({provider:{works:[]}}));t.mock.method(saved,'listMine',async()=>({providerIds:[],workIds:[]}));
 t.mock.method(orders,'listOrders',async()=>{throw Error('offline');});await p.loadCloudDashboard('provider');assert.notEqual(p.data.dashboardError,'');
 t.mock.method(orders,'listOrders',()=>{calls++;return new Promise(r=>{finish=r;});});const task=p.retryDashboard();p.retryDashboard();assert.equal(calls,1);finish([]);await task;assert.equal(p.data.role,'provider');assert.equal(p.data.dashboardError,'');assert.equal(p.data.dashboardLoading,false);assert.equal(p.data.providerStats[0].value,0);
});
test('real storefront preview never falls back to demo identity',()=>{
 const p=page();const urls=[];global.wx={showToast(){},navigateTo({url}){urls.push(url);}};
 p.previewStorefront();assert.equal(urls.length,0);p.serverAccountId='real';p.data.dashboardLoading=true;p.previewStorefront();assert.equal(urls.length,0);p.data.dashboardLoading=false;p.previewStorefront();assert.match(urls[0],/id=real&workspace=provider/);
});

test('new dashboard account or role clears old values before reading; late account response is ignored',async t=>{
 for(const change of ['account','role']){
  let owner='real',finish;global.getApp=()=>({globalData:{account:{id:owner}}});const p=page();p.dashboardOwner='real';p.data.role='buyer';p.data.account={nickname:'old'};p.data.buyerStats=[{value:9}];p.data.assets=[{value:8}];
  t.mock.method(account,'peekMine',()=>null);t.mock.method(account,'getMine',()=>new Promise(r=>{finish=r;}));t.mock.method(orders,'listOrders',async()=>[]);t.mock.method(saved,'listMine',async()=>({providerIds:[],workIds:[]}));t.mock.method(catalog,'getProvider',async()=>({provider:{works:[]}}));
  if(change==='account')owner='new';const task=p.loadCloudDashboard(change==='role'?'provider':'buyer');assert.deepEqual(p.data.buyerStats,[]);assert.deepEqual(p.data.assets.map(x=>x.value),['—','—','—']);assert.equal(p.data.account,null);
  owner='next';let writes=0;p.setData=()=>{writes++;};finish({id:change==='account'?'new':'real',nickname:'late'});await task;assert.equal(writes,0);assert.equal(p.serverAccountId,null);
 }
});

test('collection navigation survives first load and failure for both roles without inventing zero counts',async t=>{
 global.getApp=()=>({globalData:{account:{id:'real'}}});
 t.mock.method(account,'peekMine',()=>null);t.mock.method(account,'getMine',async()=>{throw Error('offline');});t.mock.method(orders,'listOrders',async()=>[]);t.mock.method(saved,'listMine',async()=>({providerIds:[],workIds:[]}));
 const urls=[];global.wx={navigateTo({url}){urls.push(url);}};
 for(const role of ['buyer','provider']){
  const p=page();assert.deepEqual(p.data.assets.map(x=>x.key),['followed','liked','referenced']);
  await p.loadCloudDashboard(role);assert.notEqual(p.data.dashboardError,'');
  assert.deepEqual(p.data.assets.map(x=>x.value),['—','—','—']);
  for(const item of p.data.assets)p.openAssets({currentTarget:{dataset:{type:item.key}}});
 }
 assert.deepEqual(urls,Array(2).fill(['followed','liked','referenced']).flat().map(type=>`/pages/me-assets/index?type=${type}`));
});

 test('buyer highlights count all initiated orders independently from completed and active orders', async t=>{
  global.getApp=()=>({globalData:{account:{id:'real'}}});global.wx={getStorageSync(){},setStorageSync(){},removeStorageSync(){}};
  require('../miniprogram/utils/display-cache').clear();
  t.mock.method(account,'peekMine',()=>null);t.mock.method(account,'getMine',async()=>({id:'real',nickname:'测试',username:'Kehaar'}));t.mock.method(saved,'listMine',async()=>({providerIds:['a','b'],workIds:['w']}));
  t.mock.method(orders,'listOrders',async()=>[{id:'1',viewerRole:'BUYER',stage:'COMPLETED'},{id:'2',viewerRole:'BUYER',stage:'DECLINED'},{id:'3',viewerRole:'BUYER',stage:'REQUESTED'},{id:'4',viewerRole:'PROVIDER',stage:'COMPLETED'}]);
  const p=page();await p.loadCloudDashboard('buyer');assert.deepEqual(p.data.buyerHighlights.map(x=>x.value),[1,2,3]);
  assert.equal(p.data.account.username,'Kehaar'); assert.deepEqual(p.data.buyerHighlights.map(x=>x.label),['喜欢','关注','合作']);
  const urls=[],groups=[];wx.navigateTo=o=>urls.push(o.url);wx.switchTab=o=>urls.push(o.url);wx.setStorageSync=(k,v)=>groups.push([k,v]);
  for(const key of ['orders','liked','followed'])p.openBuyerHighlight({currentTarget:{dataset:{type:key}}});p.openBuyerCooperations();p.openFunds();p.openBuyerProjects();
  assert.deepEqual(urls,['/pages/me-activity/index?mode=coops','/pages/me-assets/index?type=liked','/pages/me-assets/index?type=followed','/pages/orders/index','/pages/funds/index','/pages/projects/index']);assert.deepEqual(groups.map(x=>x[1]),['history']);
 });
