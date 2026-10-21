const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const componentRequire=require('node:module').createRequire(require.resolve('../miniprogram/components/first-use-consent/index'));

test('first-use consent discards callbacks after detach, logout, or account switch at either authorization stage',async()=>{
 for(const stage of ['privacy','location'])for(const change of ['detach','logout','switch']){
  let definition,privacyDone,locationDone,calls=0,completed=0;
  const app={globalData:{account:{id:'one'}},sessionRevision:1},values=new Map();
  const wx={getStorageSync:k=>values.get(k),setStorageSync:(k,v)=>values.set(k,v),
   requirePrivacyAuthorize:({success})=>{privacyDone=success;},getFuzzyLocation:({success})=>{calls++;locationDone=success;}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/components/first-use-consent/index'),'utf8'),{Component:v=>definition=v,wx,getApp:()=>app,require:componentRequire});
  const c={...definition.methods,data:{...definition.data},setData(v){Object.assign(this.data,v)},triggerEvent(){completed++;}};
  definition.lifetimes.attached.call(c);const pending=c.authorize();
  if(stage==='location'){privacyDone();await Promise.resolve();}
  if(change==='detach')definition.lifetimes.detached.call(c);
  else if(change==='logout'){app.sessionRevision++;app.globalData.account=null;}
  else app.globalData.account={id:'two'};
  if(stage==='privacy'){
   privacyDone();await Promise.resolve();
   if(locationDone)locationDone({latitude:31,longitude:121});
  }else locationDone({latitude:31,longitude:121});
  await pending;
  assert.equal(calls,stage==='privacy'?0:1,`${stage}/${change}: no new location after invalidation`);
  assert.equal(app.globalData.pendingDiscoveryLocation,undefined);
  assert.equal(values.size,0);assert.equal(completed,0);
  if(change!=='detach')assert.equal(c.data.busy,false);
 }
});
test('career ordering is a complete permutation, survives module reload and stays isolated by account',()=>{
 const storage=new Map();let id='one';
 const load=()=>{const module={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/data/home-preferences'),'utf8'),{module,getApp:()=>({globalData:{account:{id}}}),wx:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v)}});return module.exports;};
 const api=load(),order=['摄影','后期','毛娘','妆娘'];api.save(order);order[0]='bad';
 assert.equal(load().read().join(','),'摄影,后期,毛娘,妆娘');
 assert.throws(()=>api.save(['摄影','摄影','毛娘','妆娘']));
 id='two';assert.equal(api.read()[0],'妆娘');id='one';assert.equal(api.read()[0],'摄影');
});
test('first-use consent does not request location on opening, refusal remains recoverable and manual choice is remembered',async()=>{
 let definition,calls=0;const values=new Map(),app={globalData:{}};
 const wx={getStorageSync:k=>values.get(k),setStorageSync:(k,v)=>values.set(k,v),requirePrivacyAuthorize:({success})=>success(),getFuzzyLocation:({fail})=>{calls++;fail(Error('denied'));}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/components/first-use-consent/index'),'utf8'),{Component:v=>definition=v,wx,getApp:()=>app,require:componentRequire});
 const c={...definition.methods,data:{...definition.data},setData(v){Object.assign(this.data,v)},triggerEvent(){}};
 definition.lifetimes.attached.call(c);assert.equal(c.data.visible,true);assert.equal(calls,0);
 await c.authorize();assert.equal(calls,1);assert.equal(c.data.busy,false);assert.ok(c.data.error);assert.equal(app.globalData.pendingDiscoveryLocation,undefined);
 c.manual();assert.equal(c.data.visible,false);definition.lifetimes.attached.call(c);assert.equal(c.data.visible,false);
});
test('successful location consent keeps only temporary coordinates for the authenticated discovery flow',async()=>{
 let definition;const app={globalData:{}},values=new Map();
 const wx={getStorageSync:k=>values.get(k),setStorageSync:(k,v)=>values.set(k,v),requirePrivacyAuthorize:({success})=>success(),getFuzzyLocation:({success})=>success({latitude:31,longitude:121})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/components/first-use-consent/index'),'utf8'),{Component:v=>definition=v,wx,getApp:()=>app,require:componentRequire});
 const c={...definition.methods,data:{...definition.data},setData(v){Object.assign(this.data,v)},triggerEvent(){}};
 definition.lifetimes.attached.call(c);await c.authorize();assert.equal(c.data.visible,false);assert.equal(app.globalData.pendingDiscoveryLocation.latitude,31);assert.equal([...values.values()].includes(31),false);
});
