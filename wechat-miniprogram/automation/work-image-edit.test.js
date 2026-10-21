const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const imageEdit = require('../miniprogram/utils/work-image-edit');
const { normalizeDraft } = require('../cloudfunctions/provider-catalog-draft/draft-core');
const catalog = require('../miniprogram/services/cloud-catalog');
const spec = { enabled:true, text:'@artist', position:'bottom-right', size:3, opacity:60 };
const work = {id:'w1',title:'作品',description:'说明',price:100,tags:[], imagePreviews:['display-a','source-b'], imageAssetIds:['asset_a','asset_b'], mediaStatuses:['READY','PENDING_SECURITY_REVIEW'], sourceImagePreviews:['source-a','source-b'],sourceImageAssetIds:['asset_source_a','asset_b'],sourceMediaStatuses:['READY','PENDING_SECURITY_REVIEW'],watermarks:[spec,null]};
function fixture(renderer = imageEdit, app = {globalData:{account:{id:'owner'}}}, picker = {}) {
 let page;
 vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/provider-profile/index.js'),'utf8'), {Page:p=>page=p, require:n=>n.endsWith('work-image-edit')?renderer:n.endsWith('work-media-picker')?picker:{}, wx:{}, getApp:()=>app});
 page.data={...page.data,selectedWork:structuredClone(work),workDrafts:[structuredClone(work)],selectedWorkIndex:0,profileDraft:{username:'artist'}};
 page.setData=patch=>{for(const [key,value] of Object.entries(patch)){const parts=key.split('.');let obj=page.data;for(const part of parts.slice(0,-1))obj=obj[part];obj[parts.at(-1)]=value;}};
 page.refreshDerived=()=>{page.data.selectedWork=page.data.workDrafts[0];};
 page.saveSelectedFile=async()=>({preview:'generated',assetId:'asset_generated',status:'PENDING_SECURITY_REVIEW'});
 return page;
}
test('封面和图序移动保留原图、水印和审核状态对应，原对象不被修改',()=>{
 const next=imageEdit.move(work,1,0);assert.equal(next.imageAssetIds[0],'asset_b');assert.equal(next.sourceImageAssetIds[1],'asset_source_a');assert.equal(next.watermarks[1],spec);assert.equal(next.mediaStatuses[0],'PENDING_SECURITY_REVIEW');assert.equal(work.imageAssetIds[0],'asset_a');
 assert.strictEqual(imageEdit.move(work,-1,0),work);
});
test('移除图片不留下错位设置',()=>{const next=imageEdit.remove(work,0);assert.deepEqual(next.sourceImageAssetIds,['asset_b']);assert.deepEqual(next.watermarks,[null]);});
test('旧作品无设置时按原图初始化',()=>{const next=imageEdit.prepare({imagePreviews:['url'],imageAssetIds:['asset_a']});assert.deepEqual(next.sourceImageAssetIds,['asset_a']);assert.deepEqual(next.watermarks,[null]);});
test('关闭水印恢复原图，零生成零上传',async()=>{let calls=0;const p=fixture({...imageEdit,render:async()=>{calls++;}});p.openImageSettings({currentTarget:{dataset:{index:0}}});p.data.imageSettings.spec.enabled=false;await p.applyWatermark();assert.equal(p.data.workDrafts[0].imageAssetIds[0],'asset_source_a');assert.equal(p.data.workDrafts[0].watermarks[0],null);assert.equal(calls,0);});
test('设置未变不重新生成或上传',async()=>{let calls=0;const p=fixture({...imageEdit,render:async()=>{calls++;}});p.saveSelectedFile=async()=>{calls++;};p.openImageSettings({currentTarget:{dataset:{index:0}}});await p.applyWatermark();assert.equal(calls,0);});
test('组图失败原作品保持不变，可留在设置页重试',async()=>{const p=fixture({...imageEdit,render:async()=>{throw new Error('测试网络失败');}});p.openImageSettings({currentTarget:{dataset:{index:1}}});p.data.imageSettings.spec=spec;p.data.imageSettings.all=true;await p.applyWatermark();assert.equal(p.data.workDrafts[0].imageAssetIds[1],'asset_b');assert(p.data.imageSettings);assert.match(p.data.imageSettingsError,/测试网络失败/);assert.equal(p.data.uploadingImages,false);});
test('完成水印设置只生成和上传一次',async()=>{let rendered=0,uploaded=0;const p=fixture({...imageEdit,render:async()=>{rendered++;return 'temp';}});p.saveSelectedFile=async()=>{uploaded++;return {preview:'url',assetId:'asset_new',status:'PENDING_SECURITY_REVIEW'};};p.openImageSettings({currentTarget:{dataset:{index:1}}});p.data.imageSettings.spec=spec;await p.applyWatermark();assert.equal(rendered,1);assert.equal(uploaded,1);assert.equal(p.data.workDrafts[0].sourceImageAssetIds[1],'asset_b');assert.equal(p.data.workDrafts[0].mediaStatuses[1],'PENDING_SECURITY_REVIEW');});
test('署名、原图和设置通过客户端及服务端往返，不用正文拼接',()=>{
 const value={career:'摄影',profile:{},services:[],works:[{...work,creditCoser:'小林',creditMine:'摄影'}]};
 const server=normalizeDraft(catalog.toServerDraft(value));assert.equal(server.works[0].creditCoser,'小林');assert.equal(server.works[0].watermarks[0].text,'@artist');
 const client=catalog.toClientDraft(server,{},[{assetId:'asset_source_a',tempFileURL:'original',status:'READY'}]);assert.equal(client.works[0].sourceImagePreviews[0],'original');assert.equal(client.works[0].creditMine,'摄影');
});
test('服务端拒绝错位设置、原图冒充水印和过长署名',()=>{
 const make=()=>catalog.toServerDraft({profile:{},works:[work]});
 let draft=make();draft.works[0].watermarks=[];assert.throws(()=>normalizeDraft(draft),/match images/);
 draft=make();draft.works[0].sourceImageAssetIds=['asset_a','asset_b'];assert.throws(()=>normalizeDraft(draft),/invalid/);
 draft=make();draft.works[0].creditMine='字'.repeat(101);assert.throws(()=>normalizeDraft(draft),/too long/);
});
test('Canvas调用契约：导出展示文件、保持图像完整和水印布局',async()=>{
 const calls=[];const ctx={clearRect(){},drawImage(...a){calls.push(['image',...a.slice(1)]);},measureText(){return {width:100};},fillText(...a){calls.push(['text',...a]);}};
 const canvas={getContext:()=>ctx,createImage(){return {set src(_){this.onload();}};}};
 global.wx={getImageInfo:o=>o.success({path:'source',width:1080,height:1620}),canvasToTempFilePath:o=>{assert.strictEqual(o.canvas,canvas);o.success({tempFilePath:'result.jpg'});}};
 const page={createSelectorQuery:()=>({select:()=>({fields:()=>({exec:cb=>cb([{node:canvas}])})})})};
 try{assert.equal(await imageEdit.render(page,'source',spec),'result.jpg');assert.deepEqual(calls[0],['image',0,0,1080,1620]);assert.equal(calls[1][1],'@artist');assert.equal(canvas.height,1620);}finally{delete global.wx;}
});

test('未完成设置或取消不会修改已保存的水印参数',()=>{const p=fixture();p.data.selectedWork=p.data.workDrafts[0];p.openImageSettings({currentTarget:{dataset:{index:0}}});p.data.imageSettings.spec.text='新文字';p.closeImageSettings();assert.equal(p.data.workDrafts[0].watermarks[0].text,'@artist');});

for (const operation of ['applyWatermark']) {
 test(`${operation}：切换账号后丢弃旧任务失败，不覆盖当前页面提示`,async()=>{
  const app={globalData:{account:{id:'owner'}}};
  let rejectRender;
  const p=fixture({...imageEdit,render:()=>new Promise((_,reject)=>{rejectRender=reject;})},app);
  p.openImageSettings({currentTarget:{dataset:{index:1}}});
  p.data.imageSettings.spec=spec;
  const pending=p[operation]();
  app.globalData.account={id:'another-owner'};
  p.data.imageSettingsError='当前账号提示';
  rejectRender(new Error('旧账号图片处理失败'));
  await pending;
  assert.equal(p.data.imageSettingsError,'当前账号提示');
  assert.equal(p.data.workDrafts[0].imageAssetIds[1],'asset_b');
  assert.equal(p.data.uploadingImages,false);
 });
}

test('追加图片上传完成前切号，同编号作品不能接收旧账号图片',async()=>{
 const app={globalData:{account:{id:'owner'}}};const p=fixture(imageEdit,app);
 let finish;p.saveSelectedFile=()=>new Promise(resolve=>{finish=resolve;});
 const pending=p.uploadWorkImages([{tempFilePath:'temp'}],'w1');
 app.globalData.account={id:'another-owner'};
 p.data.workDrafts=[{...structuredClone(work),title:'另一个账号的作品'}];
 p.data.editorError='新账号提示';
 finish({preview:'old-owner-url',assetId:'old-owner-asset',status:'READY'});await pending;
 assert.equal(p.data.workDrafts[0].imagePreviews.length,2);
 assert.equal(p.data.editorError,'新账号提示');
 assert.equal(p.data.uploadingImages,false);
});
for (const fail of [false,true]) {
 test(`须知图片上传${fail?'失败':'成功'}前切号，不修改新账号图片或提示`,async()=>{
  const app={globalData:{account:{id:'owner'}}};let choose;
  const p=fixture(imageEdit,app,{chooseImageMedia:o=>{choose=o.success;}});
  let finish,reject;p.saveSelectedFile=()=>new Promise((yes,no)=>{finish=yes;reject=no;});
  let removed=0;p.removePendingFile=()=>{removed++;};
  p.chooseNoticeImage();const pending=choose({tempFiles:[{tempFilePath:'temp'}]});
  app.globalData.account={id:'another-owner'};
  p.data.noticeImageDraft='new-owner-image';p.data.editorError='新账号提示';
  if(fail)reject(new Error('旧任务失败'));else finish({preview:'old-owner-image',assetId:'old-owner-asset'});
  await pending;
  assert.equal(p.data.noticeImageDraft,'new-owner-image');assert.equal(p.data.editorError,'新账号提示');assert.equal(removed,0);
 });
}

test('同账号追加图片部分失败保留成功项，原图和状态仍对应',async()=>{
 const p=fixture();p.saveSelectedFile=async file=>{if(file.tempFilePath==='bad')throw new Error('失败');return {preview:'new-image',assetId:'new-asset',status:'PENDING_SECURITY_REVIEW'};};
 await p.uploadWorkImages([{tempFilePath:'good'},{tempFilePath:'bad'}],'w1');
 assert.equal(p.data.workDrafts[0].imagePreviews.length,2);assert.equal(p.data.pendingImagePreviews[0].state,'上传完成');assert.match(p.data.editorError,/1 张图片上传失败/); p.removeCasePendingImage({currentTarget:{dataset:{id:p.data.pendingImagePreviews[1].id}}}); const result=p.data.workDrafts[0];assert.equal(result.imagePreviews.length,3);assert.equal(result.sourceImageAssetIds[2],'new-asset');assert.equal(result.mediaStatuses[2],'PENDING_SECURITY_REVIEW');assert.equal(result.watermarks[2],null);
});
test('同账号须知图片成功替换，清理旧临时图',async()=>{
 let choose;const p=fixture(imageEdit,undefined,{chooseImageMedia:o=>{choose=o.success;}});
 p.data.noticeImageDraft='old';let removed;p.removePendingFile=path=>{removed=path;};
 p.chooseNoticeImage();await choose({tempFiles:[{tempFilePath:'temp'}]});
 assert.equal(p.data.noticeImageDraft,'generated');assert.equal(p.data.noticeImageAssetId,'asset_generated');assert.equal(removed,'old');assert.equal(p.data.uploadingImages,false);
});


test('选图先进入水印，下一步才上传，并保留原图及展示图',async()=>{
 let renders=0,uploads=[];const p=fixture({...imageEdit,render:async(_,src)=>{renders++;return 'marked-'+src;}});
 p.saveSelectedFile=async file=>{uploads.push(file.tempFilePath);return {preview:file.tempFilePath,assetId:file.tempFilePath,status:'READY'};};
 p.stageCaseImages([{tempFilePath:'third'},{tempFilePath:'first'}],'w1');assert.equal(uploads.length,0);assert.equal(p.data.imageSettings.batch,true);
 p.data.imageSettings.spec=spec;await p.applyWatermark();assert.equal(p.data.imageSettings,null);assert.equal(renders,2);
 assert.deepEqual(Array.from(p.data.workDrafts[0].imagePreviews).slice(2),['marked-third','marked-first']);assert.deepEqual(Array.from(p.data.workDrafts[0].sourceImagePreviews).slice(2),['third','first']);
});
test('删除上传中图片后迟到结果不会复活，剩余图片保持顺序',async()=>{
 const p=fixture();let finish;p.saveSelectedFile=file=>file.tempFilePath==='remove'?new Promise(r=>finish=r):Promise.resolve({preview:'keep',assetId:'keep',status:'READY'});
 const task=p.uploadWorkImages([{tempFilePath:'remove'},{tempFilePath:'keep'}],'w1');p.removeCasePendingImage({currentTarget:{dataset:{id:p.data.pendingImagePreviews[0].id}}});finish({preview:'removed',assetId:'removed',status:'READY'});await task;
 assert.deepEqual(Array.from(p.data.workDrafts[0].imagePreviews),['display-a','source-b','keep']);assert.equal(p.data.pendingImagePreviews.length,0);
});
test('水印取消不触发上传，也不改变已有图片',()=>{const p=fixture();let calls=0;p.saveSelectedFile=()=>{calls++;};p.stageCaseImages([{tempFilePath:'new'}],'w1');p.closeImageSettings();assert.equal(calls,0);assert.equal(p.data.workDrafts[0].imagePreviews.length,2);assert.equal(p.caseSelection,null);});
