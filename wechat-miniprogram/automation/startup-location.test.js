const test = require('node:test');
const assert = require('node:assert/strict');
const location = require('../miniprogram/services/startup-location');

function fixture(choice = 'located', authorized = true) {
  const app = { globalData: {} };
  let calls = 0, finish;
  const wx = {
    getStorageSync: () => choice,
    getSetting: ({ success }) => success({ authSetting: { 'scope.userFuzzyLocation': authorized } }),
    getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
    getFuzzyLocation: ({ success }) => { calls++; finish = success; }
  };
  return { app, wx, calls: () => calls, finish: value => finish(value) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('new/manual/revoked permission never starts automatic location or opens an authorization prompt', async () => {
  for (const [choice, authorized] of [[undefined, true], ['manual', true], ['located', false]]) {
    const f = fixture(choice, authorized);
    if (choice === undefined) f.wx.getStorageSync = () => undefined;
    await location.start(f.app, f.wx);
    assert.equal(f.calls(), 0);
    assert.equal(f.app.globalData.pendingDiscoveryLocation, undefined);
  }
});
test('one request per foreground, a later foreground gets fresh coordinates', async () => {
  const f = fixture();
  const first = location.start(f.app, f.wx);
  location.start(f.app, f.wx);
  await flush(); assert.equal(f.calls(), 1);
  f.finish({ latitude: 31, longitude: 121 }); await first;
  assert.equal(f.app.globalData.pendingDiscoveryLocation.latitude, 31);
  location.start(f.app, f.wx); await flush(); assert.equal(f.calls(), 1);
  location.hide(f.app);
  const second = location.start(f.app, f.wx); await flush();
  assert.equal(f.calls(), 2);
  f.finish({ latitude: 30, longitude: 120 }); await second;
  assert.equal(f.app.globalData.pendingDiscoveryLocation.latitude, 30);
  assert.equal(f.app.discoveryLocationReady, null);
});
test('manual selection/logout invalidates late coordinates without restarting in the same foreground', async () => {
  const f = fixture(), pending = location.start(f.app, f.wx);
  await flush(); location.cancel(f.app);
  f.finish({ latitude: 31, longitude: 121 }); await pending;
  assert.equal(f.app.globalData.pendingDiscoveryLocation, undefined);
  location.start(f.app, f.wx); await flush(); assert.equal(f.calls(), 1);
});
test('changed privacy requirements and location failure do not silently accept consent', async () => {
  const f = fixture(); f.wx.getPrivacySetting = ({ success }) => success({ needAuthorization: true });
  await location.start(f.app, f.wx); assert.equal(f.calls(), 0);
  const g = fixture(); g.wx.getFuzzyLocation = ({ fail }) => fail(Error('unavailable'));
  await location.start(g.app, g.wx);
  assert.equal(g.app.discoveryLocationReady, null);
  assert.equal(g.app.globalData.pendingDiscoveryLocation, undefined);
});

test('location timing separates permission and coordinates without retaining position', async t => {
 const performance=require('../miniprogram/utils/screen-performance'); performance.clear();
 let now=100; t.mock.method(Date,'now',()=>now);
 const f=fixture(); const pending=location.start(f.app,f.wx); await flush();
 now=460;f.finish({latitude:31.234567,longitude:121.987654});await pending;
 const samples=performance.read();assert.deepEqual(samples.map(s=>[s.screen,s.source,s.milliseconds]),[['location-permission','checked',0],['location-coordinate','success',360]]);
 assert.equal(JSON.stringify(samples).includes('31.234567'),false);assert.equal(JSON.stringify(samples).includes('121.987654'),false);
 performance.clear();const g=fixture();const stale=location.start(g.app,g.wx);await flush();location.cancel(g.app);g.finish({latitude:31,longitude:121});await stale;
 assert.equal(performance.read().filter(s=>s.screen==='location-coordinate').length,0);
 performance.clear();
});

test('first consent timing keeps user decision separate and does not retain coordinates',async()=>{
 const performance=require('../miniprogram/utils/screen-performance');performance.clear();
 let definition,calls=0,complete;global.Component=value=>definition=value;
 delete require.cache[require.resolve('../miniprogram/components/first-use-consent/index')];require('../miniprogram/components/first-use-consent/index');delete global.Component;
 const app={sessionRevision:1,globalData:{account:{id:'one'}}};global.getApp=()=>app;
 global.wx={requirePrivacyAuthorize:({success})=>success(),getFuzzyLocation:({success})=>{calls++;success({latitude:31.234567,longitude:121.987654});},setStorageSync(){}};
 const component={...definition.methods,alive:true,data:{busy:false},setData(value){Object.assign(this.data,value);},triggerEvent(name,value){complete=value;}};
 await component.authorize();assert.equal(calls,1);assert.equal(complete.choice,'located');
 assert.deepEqual(performance.read().map(s=>[s.screen,s.source]),[['first-location-consent','accepted'],['location-coordinate','success']]);
 assert.equal(JSON.stringify(performance.read()).includes('31.234567'),false);performance.clear();
});


test('unreadable remembered consent skips automatic location without throwing', async () => {
 const f=fixture();f.wx.getStorageSync=()=>{throw Error('storage unavailable');};
 await assert.doesNotReject(async()=>location.start(f.app,f.wx));
 assert.equal(f.calls(),0);assert.equal(f.app.globalData.pendingDiscoveryLocation,undefined);
});

test('first-use consent stays usable when optional local storage fails', async () => {
 const vm=require('node:vm'),fs=require('node:fs'),{createRequire}=require('node:module');
 const file=require.resolve('../miniprogram/components/first-use-consent/index');let definition,complete,shown=0;
 const app={sessionRevision:1,globalData:{account:{id:'one'}}};
 const wx={getStorageSync(){throw Error('unreadable');},setStorageSync(){throw Error('quota');},hideTabBar(){},showTabBar(){shown++;},requirePrivacyAuthorize:({success})=>success(),getFuzzyLocation:({success})=>success({latitude:31,longitude:121})};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{Component:d=>definition=d,require:createRequire(file),getApp:()=>app,getCurrentPages:()=>[{route:'pages/discover/index'}],wx});
 const component={...definition.methods,data:{...definition.data},setData(v){Object.assign(this.data,v);},triggerEvent(n,v){complete=v;}};
 assert.doesNotThrow(()=>definition.lifetimes.attached.call(component));assert.equal(component.data.visible,true);
 assert.doesNotThrow(()=>component.manual());assert.equal(complete.choice,'manual');assert.equal(component.data.visible,false);assert.equal(shown,1);
 definition.lifetimes.attached.call(component);await component.authorize();
 assert.equal(complete.choice,'located');assert.equal(component.data.visible,false);assert.equal(component.data.busy,false);assert.equal(component.data.error,'');assert.equal(shown,2);
 assert.equal(app.globalData.pendingDiscoveryLocation.latitude,31);
});
