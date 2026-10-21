const test=require('node:test');
const assert=require('node:assert/strict');
const account=require('../miniprogram/services/cloud-account');
const catalog=require('../miniprogram/services/cloud-catalog');
let definition;global.Page=value=>{definition=value;};require('../miniprogram/pages/account-profile/index');delete global.Page;
test('头像处理各等待阶段切账号后不写新账号页面或继续上传审核',async t=>{
 for(const phase of ['file','upload','status']){
  const app={globalData:{account:{id:'a'}}};global.getApp=()=>app;
  let finish,writes=0,uploads=0,statuses=0,cancels=0;
  const waiting=new Promise(resolve=>{finish=resolve;});
  global.wx={getFileInfo(options){if(phase==='file')waiting.then(options.success);else options.success({size:100});},showLoading(){},hideLoading(){},showToast(){assert.fail('不能提示新账号');}};
  t.mock.method(catalog,'uploadImage',async()=>{uploads++;return phase==='upload'?waiting:{assetId:'asset-a',fileId:'file-a',preview:'avatar-a'};});
  t.mock.method(catalog,'getImageStatus',async()=>{statuses++;return phase==='status'?waiting:{status:'READY'};});
  t.mock.method(catalog,'cancelImage',async()=>{cancels++;});
  const p={...definition,cloudMode:true,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  const request=p.chooseAvatar({detail:{avatarUrl:'tmp-avatar'}});
  await new Promise(resolve=>setImmediate(resolve));
  app.globalData.account={id:'b'};p.setData=()=>{writes++;};
  finish(phase==='file'?{size:100}:phase==='upload'?{assetId:'asset-a',fileId:'file-a',preview:'avatar-a'}:{status:'READY'});
  await request;
  assert.equal(writes,0);assert.equal(cancels,0);
  assert.equal(uploads,phase==='file'?0:1);assert.equal(statuses,phase==='status'?1:0);
 }
});
test('当前账号正常保存更新会话并返回，请求中不重复提交',async t=>{
 const app={globalData:{account:{id:'a'}}};global.getApp=()=>app;
 let resolve,calls=0,backs=0;
 global.wx={setStorageSync(){},showToast(){},navigateBack(){backs++;}};
 t.mock.method(account,'updateMine',()=>{calls++;return new Promise(yes=>{resolve=yes;});});
 const p={...definition,cloudMode:true,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
 p.data.draft.nickname='新昵称';const first=p.save();await p.save();assert.equal(calls,1);
 resolve({id:'a',nickname:'新昵称',version:2});await first;
 assert.equal(app.globalData.account.nickname,'新昵称');assert.equal(backs,1);assert.equal(p.data.saving,false);
});
test('资料读取和保存的迟到结果不影响已离页或新账号',async t=>{
 for(const action of ['loadCloud','save'])for(const change of ['closed','account'])for(const failed of [false,true]){
  const app={globalData:{account:{id:'a'}}};global.getApp=()=>app;
  let resolve,reject,writes=0,effects=0;
  global.wx={setStorageSync(){effects++;},showToast(){effects++;},navigateBack(){effects++;}};
  t.mock.method(account,action==='save'?'updateMine':'getMine',()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
  const p={...definition,cloudMode:true,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  p.data.draft.nickname='新昵称';
  const request=p[action]();
  if(change==='closed')await p.onUnload();else app.globalData.account={id:'b'};
  p.setData=()=>{writes++;};
  if(failed)reject(Error('offline'));else resolve({id:'a',nickname:'新昵称',version:2});
  await request;
  assert.equal(writes,0);assert.equal(effects,0);
  assert.equal(app.globalData.account.id,change==='closed'?'a':'b');
 }
});


test('confirmed profile save survives optional cache failure and never cancels its saved avatar',async t=>{
 const app={globalData:{account:{id:'a'}}};global.getApp=()=>app;
 let backs=0,cancels=0;const toasts=[];
 global.wx={setStorageSync(){throw Error('quota exceeded');},showToast(value){toasts.push(value.title);},navigateBack(){backs++;}};
 t.mock.method(account,'updateMine',async()=>({id:'a',nickname:'新昵称',version:2,avatarAssetId:'saved-avatar'}));
 t.mock.method(catalog,'cancelImage',async()=>{cancels++;});
 const p={...definition,cloudMode:true,pendingAvatar:{assetId:'saved-avatar',fileId:'saved-file'},data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
 p.data.draft.nickname='新昵称';await p.save();await p.onUnload();
 assert.equal(p.saved,true);assert.equal(p.pendingAvatar,null);assert.equal(cancels,0);
 assert.equal(p.data.accountVersion,2);assert.equal(p.data.saving,false);
 assert.equal(app.globalData.account.nickname,'新昵称');assert.equal(backs,1);
 assert.deepEqual(toasts,['个人资料已保存']);
});
