const test=require('node:test');
const assert=require('node:assert/strict');
const projects=require('../miniprogram/services/cloud-projects');
const account=require('../miniprogram/services/cloud-account');
let definition;global.Page=value=>{definition=value;};require('../miniprogram/pages/brief/index');delete global.Page;
function page(){return {...definition,cloudMode:true,projectId:'p',pendingCloudAssets:[],pendingSavedFiles:[],removedCloudAssets:[],data:{...structuredClone(definition.data),project:{id:'p',version:3},canSave:true,projectName:'项目',date:'2099-01-01',city:'上海市',cityCode:'310100',location:'地点',description:'说明'},setData(patch){Object.assign(this.data,patch);}};}
test('项目保存及发现偏好使用同一提交快照，正常成功返回',async t=>{
 const p=page();let resolve,saved,preference,backs=0;
 global.getApp=()=>({globalData:{account:{id:'a'}}});global.wx={navigateBack(){backs++;},showToast(){}};
 t.mock.method(projects,'saveProject',(id,version,fields)=>{saved=fields;return new Promise(yes=>{resolve=yes;});});
 t.mock.method(account,'getDiscoveryPreference',async()=>({preference:{version:1}}));
 t.mock.method(account,'saveDiscoveryPreference',async(version,value)=>{preference=value;});
 const request=p.save();assert.equal(p.data.actionPending,true);assert.equal(p.data.processingImages,false);p.data.city='北京市';p.data.cityCode='110100';resolve({});await request;
 assert.equal(saved.city,'上海市');assert.deepEqual(preference,{cityName:'上海市',cityCode:'310100'});assert.equal(backs,1);
});
test('Brief保存离页或切账号后不继续同步偏好、不回写跳转',async t=>{
 for(const change of ['unload','account'])for(const failed of [false,true]){
  const p=page();let owner='a',resolve,reject,writes=0,effects=0,prefs=0;
  global.getApp=()=>({globalData:{account:{id:owner}}});global.wx={getStorageSync(){return {};},setStorageSync(){effects++;},navigateBack(){effects++;},showToast(){effects++;}};
  t.mock.method(projects,'saveProject',()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
  t.mock.method(account,'getDiscoveryPreference',async()=>{prefs++;return {preference:{version:1}};});
  t.mock.method(account,'saveDiscoveryPreference',async()=>{});
  const request=p.save();if(change==='unload')await p.onUnload();else owner='b';p.setData=()=>{writes++;};
  if(failed)reject(Error('offline'));else resolve({});await request;
  assert.equal(writes,0);assert.equal(effects,0);assert.equal(prefs,0);
 }
});
