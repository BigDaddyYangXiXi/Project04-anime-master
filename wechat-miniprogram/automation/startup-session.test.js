const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(extraWx = {}, currentRoute = "pages/discover/index"){let app,resolve,reject,calls=0;const routes=[],storage=new Map([['animeMasterRole','provider'],['animeMasterServerAccount',{id:'untrusted_cached'}]]);const ready=new Promise((a,b)=>{resolve=a;reject=b;});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/app.js'),'utf8'),{App:value=>app=value,require:name=>name==='./config/cloudbase'?{enabled:true,env:'company-test'}:name==='./utils/local-preview'?{isLocal:()=>false}:name==='./services/startup-location'?require('../miniprogram/services/startup-location'):name==='./utils/screen-performance'?require('../miniprogram/utils/screen-performance'):name==='./services/cloud-auth'?{getSession:()=>{calls++;return ready}}:{seedSession(){},clearCache(){},clearImageCache(){},clearDraftCache(){},clearStorefrontState(){},clear(){}},wx:{getStorageSync:k=>storage.get(k),...extraWx,cloud:{init(){}},setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),reLaunch:({url})=>routes.push(url),...extraWx},getCurrentPages:()=>[{route:currentRoute}],setTimeout:f=>f(),console});return {app,routes,storage,resolve,reject,calls:()=>calls};}

test('explicit logout survives cold launch until a trusted manual login succeeds',()=>{const f=fixture();f.storage.set('animeMasterSignedOut',true);f.app.onLaunch({path:'pages/discover/index'});assert.equal(f.calls(),0);assert.equal(f.app.globalData.account,null);assert.deepEqual(f.routes,['/pages/auth/index']);f.app.setServerSession({account:{id:'trusted'},roles:['BUYER']});assert.equal(f.storage.has('animeMasterSignedOut'),false);});
test('registered cold launch starts at discovery works and restores only server identity without login navigation',async()=>{const f=fixture();f.app.onLaunch({path:'pages/discover/index'});f.app.onShow({path:'pages/discover/index'});assert.equal(f.calls(),1);assert.equal(f.app.globalData.account,null);assert.equal(f.storage.get('animeMasterRole'),'buyer');assert.equal(f.routes.length,0);f.resolve({registered:true,account:{id:'trusted'},roles:['BUYER']});await f.app.sessionReady;assert.equal(f.app.globalData.account.id,'trusted');assert.equal(f.routes.length,0);const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../miniprogram/app.json')));assert.equal(config.pages[0],'pages/discover/index');});
test('unregistered and incomplete registration goes to account entry',async()=>{const f=fixture();f.app.onLaunch({path:'pages/discover/index'});f.resolve({registered:false});await f.app.sessionReady;assert.deepEqual(f.routes,['/pages/auth/index']);assert.equal(f.app.globalData.account,null);});
test('network failure never treats a cached account as a registered session',async()=>{const f=fixture();f.app.onLaunch({path:'pages/discover/index'});f.reject(Error('offline'));await assert.rejects(f.app.sessionReady,/offline/);assert.deepEqual(f.routes,['/pages/auth/index']);assert.equal(f.app.globalData.account,null);});
test('shared detail route survives authentication and warm foreground does not reset provider workspace',async()=>{const f=fixture();f.app.onLaunch({path:'pages/provider-detail/index',query:{id:'provider2',from:'分享'}});f.app.onShow({path:'pages/provider-detail/index'});assert.equal(f.routes.length,0);f.resolve({registered:true,account:{id:'trusted'}});await f.app.sessionReady;assert.equal(f.storage.get('animeMasterRole'),'provider');assert.equal(f.app.takePostAuthRoute(),'/pages/provider-detail/index?id=provider2&from=%E5%88%86%E4%BA%AB');f.app.onShow({path:'pages/discover/index'});assert.equal(f.storage.get('animeMasterRole'),'provider');assert.equal(f.routes.length,0);});
test('clearing a session while restoration is pending prevents a late response resurrecting the account',async()=>{const f=fixture();f.app.onLaunch({path:'pages/discover/index'});const pending=f.app.sessionReady;f.app.clearServerSession();f.resolve({registered:true,account:{id:'late'}});await pending;assert.equal(f.app.globalData.account,null);assert.equal(f.storage.has('animeMasterServerAccount'),false);f.app.onShow({path:'pages/orders/index'});assert.deepEqual(f.routes,['/pages/auth/index']);});
test('discovery waits for trusted startup and drops callbacks after hide or unload',async()=>{
 const {createRequire}=require('node:module');const file=path.join(__dirname,'../miniprogram/pages/discover/index.js'),req=createRequire(file);
 for(const leave of [null,'onHide','onUnload']){let done,p,initialized=0;const app={sessionRestoring:true,sessionReady:new Promise(r=>done=r)};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page:v=>p=v,require:req,getApp:()=>app,wx:{getStorageSync:()=>'',removeStorageSync(){}},console});
 p.auditMode=false;p.setData=patch=>Object.assign(p.data,patch);p.syncNativeTabBar=()=>{};p.initializeDiscovery=()=>initialized++;p.loadProviderDashboard=()=>assert.fail('must not enter provider dashboard');const pending=p.onShow();assert.equal(initialized,0);if(leave)p[leave]();app.sessionRestoring=false;done({registered:true});await pending;assert.equal(initialized,leave?0:1);assert.equal(p.data.mode,'works');
 }
});

test('an existing auth entry is not relaunched after an unregistered or failed startup session', async () => {
 for (const failed of [false, true]) {
  const f = fixture({}, 'pages/auth/index');
  f.app.onLaunch({path:'pages/auth/index'});
  if (failed) { f.reject(Error('offline')); await assert.rejects(f.app.sessionReady, /offline/); }
  else { f.resolve({registered:false}); await f.app.sessionReady; }
  assert.deepEqual(f.routes, [], 'keep the current registration/error page instead of recreating it');
  assert.equal(f.calls(), 1); assert.equal(f.app.globalData.account, null);
 }
});

test('authorized location starts while trusted session is still pending, and background invalidates it', async () => {
 let finish, locations = 0;
 const f = fixture({ getStorageSync: () => 'located',
  getSetting: ({success}) => success({authSetting:{'scope.userFuzzyLocation':true}}),
  getPrivacySetting: ({success}) => success({needAuthorization:false}),
  getFuzzyLocation: ({success}) => { locations++; finish=success; }
 });
 f.app.onLaunch({path:'pages/discover/index'}); f.app.onShow({path:'pages/discover/index'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(locations,1); assert.equal(f.app.sessionRestoring,true);
 const pending=f.app.discoveryLocationReady; f.app.onHide();
 finish({latitude:31,longitude:121}); await pending;
 assert.equal(f.app.globalData.pendingDiscoveryLocation,undefined);
 f.resolve({registered:true,account:{id:'trusted'}}); await f.app.sessionReady;
 f.app.onShow({path:'pages/discover/index'}); await new Promise(resolve=>setImmediate(resolve));
 assert.equal(locations,2); finish({latitude:30,longitude:120}); await f.app.discoveryLocationReady;
 assert.equal(f.app.globalData.pendingDiscoveryLocation.latitude,30);
});


test('account display cache failure cannot undo a verified startup session',async()=>{
 const f=fixture({setStorageSync(k){if(k==='animeMasterServerAccount')throw Error('quota exceeded');}});
 f.app.onLaunch({path:'pages/discover/index'});
 f.resolve({registered:true,account:{id:'trusted'},roles:['BUYER']});
 const session=await f.app.sessionReady;
 assert.equal(session.registered,true);assert.equal(f.app.globalData.account.id,'trusted');
 assert.equal(f.app.sessionRestoring,false);assert.deepEqual(f.routes,[]);
});


test('failed removal of the display copy cannot interrupt cleared session state',()=>{
 const f=fixture({removeStorageSync(k){if(k==='animeMasterServerAccount')throw Error('storage unavailable');}});
 f.app.setServerSession({account:{id:'trusted'},roles:['BUYER']});
 assert.doesNotThrow(()=>f.app.clearServerSession());
 assert.equal(f.app.globalData.account,null);assert.equal(f.app.globalData.roles.length,0);
 assert.equal(f.app.sessionReady,null);assert.equal(f.app.sessionRestoring,false);
 assert.equal(f.storage.get('animeMasterServerAccount').id,'trusted');
});
