const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file=require.resolve('../miniprogram/pages/account-profile/index');
const localRequire=require('node:module').createRequire(file);
function fixture({delayFileInfo=false}={}){
  let definition,resolve,reject,uploads=0,saves=0;
  const storage = new Map();
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  let fileInfoDone;
  const wx={setStorageSync:(k,v)=>storage.set(k,v),getStorageSync:k=>storage.get(k),removeStorageSync:k=>storage.delete(k),navigateBack(){},getFileInfo:({success})=>{fileInfoDone=()=>success({size:100});if(!delayFileInfo)fileInfoDone();},showToast(){},showLoading(){},hideLoading(){}};
  const catalog={uploadImage:()=>{uploads++;return pending;},getImageStatus:async()=>({status:'READY'}),cancelImage:async()=>{}};
  new Function('Page','require','wx','getApp',fs.readFileSync(file,'utf8'))(value=>{definition=value;},name=>
    name==='../../services/cloud-catalog'?catalog:name==='../../services/cloud-account'?{updateMine:async()=>{saves++;return {id:"avatar-test-owner",nickname:"昵称",version:2,avatarAssetId:"old-asset"};}}:localRequire(name),wx,()=>({globalData:{account:{id:'avatar-test-owner'}}}));
  const page={...definition,data:structuredClone(definition.data),cloudMode:true,pendingAvatar:null,
    setData(patch){for(const [key,value] of Object.entries(patch)){if(key==='draft.avatar')this.data.draft.avatar=value;else this.data[key]=value;}}};
  page.data.draft={nickname:'昵称',avatar:'old-image'};page.data.avatarAssetId='old-asset';
  return {page,resolve,reject,finishFileInfo:()=>fileInfoDone(),counts:()=>({uploads,saves})};
}
test('avatar previews immediately and nickname saves independently while duplicate upload is blocked',async()=>{
  const f=fixture(),run=f.page.chooseAvatar({detail:{avatarUrl:'new-image'}});
  await Promise.resolve();
  assert.equal(f.page.data.draft.avatar,'new-image');assert.equal(f.page.data.saving,false);assert.equal(f.page.data.avatarBusy,true);
  assert.equal(f.page.data.avatarAssetId,'old-asset');
  await f.page.save();await f.page.chooseAvatar({detail:{avatarUrl:'duplicate'}});
  assert.deepEqual(f.counts(),{uploads:1,saves:1});
  f.resolve({assetId:'new-asset',preview:'new-image',fileId:'file'});await run;
  assert.equal(f.page.data.saving,false);assert.equal(f.page.data.avatarAssetId,'new-asset');
});
test('metadata wait blocks duplicate selection but does not block nickname save',async()=>{
  const f=fixture({delayFileInfo:true}),run=f.page.chooseAvatar({detail:{avatarUrl:'new-image'}});
  assert.equal(f.page.data.avatarBusy,true);
  await f.page.chooseAvatar({detail:{avatarUrl:'duplicate'}});await f.page.save();
  assert.deepEqual(f.counts(),{uploads:0,saves:1});
  f.finishFileInfo();await Promise.resolve();f.resolve({assetId:'new',preview:'new-image'});await run;
});
test('leaving before metadata returns must not start an upload',async()=>{
  const f=fixture({delayFileInfo:true}),run=f.page.chooseAvatar({detail:{avatarUrl:'new-image'}});
  await f.page.onUnload();let updates=0;f.page.setData=()=>{updates++;};
  f.resolve({assetId:'new',preview:'new-image'});
  f.finishFileInfo();await run;assert.equal(f.counts().uploads,0);assert.equal(updates,0);
});
test('leaving during upload does not restore or save late avatar state',async()=>{
  const f=fixture(),run=f.page.chooseAvatar({detail:{avatarUrl:'new-image'}});
  await Promise.resolve();await f.page.onUnload();let updates=0;f.page.setData=()=>{updates++;};
  f.resolve({assetId:'new',preview:'new-image'});await run;
  assert.equal(f.page.pendingAvatar,null);assert.equal(f.page.data.avatarAssetId,'old-asset');
  assert.equal(updates,0);
});
test('upload failure restores the previous avatar and never enables the failed asset',async()=>{
  const f=fixture(),run=f.page.chooseAvatar({detail:{avatarUrl:'new-image'}});
  await Promise.resolve();f.reject(Error('upload failed'));await run;
  assert.equal(f.page.data.draft.avatar,'old-image');assert.equal(f.page.data.avatarAssetId,'old-asset');
  assert.equal(f.page.data.saving,false);assert.equal(f.page.data.loadError,'upload failed');
});
