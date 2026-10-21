const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const file=require.resolve('../miniprogram/pages/brief/index'),relative=require('node:module').createRequire(file);
const catalog=relative('../../services/cloud-catalog');
test('项目图片选择、上传和审核等待中离页或换账号不继续写页面',async t=>{
 for(const phase of ['picker','upload','review'])for(const leave of ['closed','account','current']){
  let definition,choose,owner='a',finish,uploads=0,reviews=0,writes=0,toasts=0;
  const waiting=new Promise(resolve=>{finish=resolve;});
  const wx={showLoading(){},hideLoading(){},showToast(){toasts++;}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:{exports:{}},Page(value){definition=value;},require:name=>name==='../../utils/work-media-picker'?{chooseImageMedia(options){choose=options.success;}}:relative(name),getApp:()=>({globalData:{account:{id:owner}}}),wx,setTimeout});
  const p={...definition,cloudMode:true,projectId:'p',pendingCloudAssets:[],pendingSavedFiles:[],data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  t.mock.method(catalog,'uploadImage',async()=>{uploads++;return phase==='upload'?waiting:{assetId:'a',fileId:'f'};});
  t.mock.method(catalog,'getImageStatus',async()=>{reviews++;return phase==='review'?waiting:{status:'READY'};});
  t.mock.method(catalog,'cancelImage',async()=>{});
  p.chooseTargetImages();let task;
  if(phase!=='picker'){task=choose({tempFiles:[{tempFilePath:'tmp'}]});await new Promise(resolve=>setImmediate(resolve));}
  if(phase!=='picker'){assert.equal(p.data.processingImages,true);assert.equal(p.data.actionPending,true);}
  if(leave==='closed')p.unloaded=true;else if(leave==='account')owner='b';if(leave!=='current')p.setData=()=>{writes++;};
  if(phase==='picker')task=choose({tempFiles:[{tempFilePath:'tmp'}]});else finish(phase==='upload'?{assetId:'a',fileId:'f'}:{status:'READY'});
  await task;assert.equal(writes,0);assert.equal(toasts,0);assert.equal(uploads,phase==='picker'&&leave!=='current'?0:1);assert.equal(reviews,phase==='review'||leave==='current'?1:0);if(leave==='current'){assert.equal(p.data.targetAssets[0].assetId,'a');assert.equal(p.data.actionPending,false);assert.equal(p.data.processingImages,false);}
 }
});
