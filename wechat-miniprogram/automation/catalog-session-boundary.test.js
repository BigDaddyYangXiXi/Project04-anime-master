const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{createRequire}=require('node:module');
const file=require.resolve('../miniprogram/services/cloud-catalog'),actual=createRequire(file);
function fixture(){
 const app={globalData:{account:{id:'old'}}},calls=[];let storageReads=0,finish;
 const wx={getStorageSync(){storageReads++;return {id:'old'};},cloud:{
  callFunction:async({data})=>{calls.push(data);return {result:{ok:true,data:{provider:null}}};},
  getTempFileURL:()=>new Promise(resolve=>{finish=resolve;})
 }};
 const module={exports:{}};
 new Function('require','module','wx','getApp',fs.readFileSync(file,'utf8'))(name=>
  name==='../config/cloudbase'?{enabled:true,env:'test'}:
  name==='../utils/local-preview'?{assertCloudAllowed(){}}:
  name==='../utils/display-cache'?{owner:()=>app.globalData.account?.id,revision:()=>0}:actual(name),module,wx,()=>app);
 return {app,api:module.exports,calls,storageReads:()=>storageReads,finish:()=>finish({fileList:[{fileID:'cloud://old',tempFileURL:'https://test/old',status:0}]})};
}
test('missing verified session never revives the stored account for own storefront',async()=>{
 const f=fixture();f.app.globalData.account=null;
 await assert.rejects(f.api.getProvider(),{code:'ACCOUNT_NOT_READY'});
 assert.equal(f.calls.length,0);assert.equal(f.storageReads(),0);
});
test('logout rejects late private image URLs even when old account remains on disk',async()=>{
 const f=fixture(),pending=f.api.resolveFileIds(['cloud://old']);
 f.app.globalData.account=null;f.finish();
 await assert.rejects(pending,/账号已切换/);assert.equal(f.storageReads(),0);
});
test('verified account and explicit public provider reads retain their destinations',async()=>{
 const f=fixture();f.app.globalData.account={id:'new'};
 await f.api.getProvider();assert.equal(f.calls[0].providerId,'new');
 f.app.globalData.account=null;await f.api.getProvider('public-provider');
 assert.equal(f.calls[1].providerId,'public-provider');assert.equal(f.storageReads(),0);
});
