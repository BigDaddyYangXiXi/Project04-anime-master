const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const catalogClient=require('../miniprogram/services/cloud-catalog');
const {normalizeDraft}=require('../cloudfunctions/provider-catalog-draft/draft-core');
const {buildPublicationPayload,validatePublishableDraft}=require('../cloudfunctions/provider-catalog-draft/publication-core');
const {loadPublicationCatalog,applyDiscovery,discoveryOptions}=require('../cloudfunctions/catalog-read/catalog-core');
function load(route,dependencies={}){let page;const context={require:name=>name.endsWith('work-image-edit')?require('../miniprogram/utils/work-image-edit'):name.endsWith('cloud-catalog')?{peekDraft:()=>null,clearStorefrontState(){},toServerDraft:catalogClient.toServerDraft,...dependencies['cloud-catalog']}:dependencies[name.split('/').pop()]||{},Page:p=>page=p,wx:{showToast(){},pageScrollTo(){},redirectTo(){},navigateBack(){}},console};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages',route,'index.js'),'utf8'),context);page.setData=(patch,callback)=>{Object.assign(page.data,patch);if(callback)callback();};return {page,context};}
test('editor service association survives save serialization, reload and public discovery filtering',async()=>{
 const assetId='asset_11111111111111111111111111111111';
 for(const linked of [false,true]){
  let saved;const {page}=load('provider-profile',{'cloud-catalog':{saveDraft:async(version,draft)=>{saved=normalizeDraft(catalogClient.toServerDraft(draft));return {version:2};}}});
  page.data.remoteEnabled=true;page.data.career='摄影';page.data.profileDraft={nickname:'作者',career:'摄影',cityCode:'310000'};
  page.data.workDrafts=[{id:'work_1',title:'作品',description:'正文',price:100.25,imageAssetIds:[assetId],imagePreviews:['image']}];
  page.data.serviceDrafts=[{id:'service_1',name:'服务',description:'说明',unit:'次',price:200,serviceMode:'ONLINE',workIds:[]}];
  page.refreshDerived();page.chooseWorkService({detail:{value:linked?'1':'0'}});await page.saveWork();
  const reloaded=catalogClient.toClientDraft(saved,{nickname:'作者'},[{assetId,tempFileURL:'image',status:'READY'}]);
  assert.equal(reloaded.works[0].price,100.25);assert.deepEqual(Array.from(reloaded.services[0].workIds),linked?['work_1']:[]);
  validatePublishableDraft(saved,'作者');
  const fixtures={provider_catalog_publications:[{provider_id:'provider_1',payload:JSON.stringify(buildPublicationPayload(saved,'provider_1')),draft_version:2,publication_version:1,published_at:1791000000000}],accounts:[{id:'provider_1',nickname:'作者',uid:'author',status:'ACTIVE'}],media_assets:[{id:assetId,owner_account_id:'provider_1',purpose:'WORK_IMAGE',storage_key:'cloud://test/work.jpg',status:'READY'}]};
  const db={from(table){let data=fixtures[table]||[];const query={select(){return query;},eq(key,value){data=data.filter(row=>row[key]===value);return query;},in(key,values){data=data.filter(row=>values.includes(row[key]));return query;},then(resolve){return Promise.resolve({data,error:null}).then(resolve);}};return query;}};
  const catalog=await loadPublicationCatalog(db);assert.equal(catalog.works.length,1);
  const found=applyDiscovery(catalog,discoveryOptions({mode:'works',cityCode:'310000',career:'摄影'}));
  assert.deepEqual(found.flatMap(provider=>provider.works.map(work=>work.id)),linked?['work_1']:[]);
  if(linked)assert.deepEqual(found[0].works[0].imageFileIds,['cloud://test/work.jpg']);
 }
});
test('editor allows zero, one and two works but still validates each supplied work and services',()=>{
 const {context}=load('provider-profile');const profile={nickname:'测试',career:'摄影',cityCode:'310000'},services=[{name:'摄影',description:'说明',unit:'次',price:100,serviceMode:'ONSITE'}],work={title:'作品',description:'说明',price:100,imageAssetIds:['asset']};
 for(const n of [0,1,2,3])assert.equal(context.canPublish(profile,services,Array.from({length:n},()=>({...work}))),true);
 assert.equal(context.canPublish(profile,[],[work]),false);assert.equal(context.canPublish(profile,services,[{...work,title:''}]),false);assert.equal(context.canPublish(profile,services,[{...work,imageAssetIds:[]}]),false);
});
test('preview does not publish until explicit confirmation; duplicate clicks and failed publishing keep correct state',async()=>{
 let calls=0,resolve,reject,marked=0;const draft={providerId:'provider',draftVersion:2};
 const {page}=load('provider-detail',{'storefront-preview-draft':{get:()=>draft,markPublished:()=>marked++},'cloud-catalog':{publishDraft:()=>{calls++;return new Promise((a,b)=>{resolve=a;reject=b;});}}});
 page.data.provider={id:'provider'};page.data.storefrontDraftPreview=true;page.auditMode=false;page.publicationDraft=draft;
 assert.equal(calls,0);page.confirmPublish();page.confirmPublish();assert.equal(calls,1);assert.equal(page.data.previewPublished,false);
 reject({code:'MEDIA_NOT_READY'});await new Promise(r=>setImmediate(r));assert.equal(page.data.publishing,false);assert.equal(marked,0);assert.equal(page.data.previewPublished,false);
 page.confirmPublish();assert.equal(calls,2);resolve({status:'APPLIED'});await new Promise(r=>setImmediate(r));assert.equal(page.data.previewPublished,true);assert.equal(marked,1);page.confirmPublish();assert.equal(calls,2);
});
test('saving storefront or work draft blocks cancel cleanup and navigation; idle cancel still works',()=>{
 for(const section of ['works','profile'])for(const saving of [true,false]){
  let cleared=0,stagedCleared=0,backs=0;const {page,context}=load('provider-profile',{'storefront-preview-draft':{clear(){stagedCleared++;}}});
  page.data.editorSection=section;page.data.saving=saving;page.clearPendingFiles=()=>{cleared++;};context.wx.navigateBack=()=>{backs++;};
  page.cancelEdit();assert.equal(cleared,saving?0:1);assert.equal(stagedCleared,saving?0:1);assert.equal(backs,saving?0:1);
 }
});

test('draft save after native back neither updates old editor nor opens preview',async()=>{
 for(const method of ['persistDraft','saveSection','saveWork'])for(const failed of [false,true]){
  let resolve,reject,writes=0,previews=0,notices=0;const response=new Promise((a,b)=>{resolve=a;reject=b;});
  const {page,context}=load('provider-profile',{'cloud-catalog':{saveDraft:()=>response},'storefront-preview-draft':{isPublished:()=>false,clear(){}}});
  page.data.remoteEnabled=true;page.data.workDrafts=[{id:'w'}];page.pendingSavedFiles=[];page.pendingCloudAssets=[];page.buildDraftValue=()=>({works:[],profile:{},services:[]});page.openDraftPreview=()=>{previews++;};context.wx.showToast=()=>{notices++;};
  const task=page[method]({});page.onUnload();page.setData=()=>{writes++;};if(failed)reject({code:'OFFLINE'});else resolve({version:2});await task;await new Promise(r=>setImmediate(r));
  assert.equal(writes,0);assert.equal(previews,0);assert.equal(notices,0);
 }
});

test('visitor preview reads the saved snapshot without writing and keeps later edits separate',async()=>{
 let preview,writes=0;const original={works:[],profile:{bio:'原内容'},services:[]},edited={works:[],profile:{bio:'后改内容'},services:[]};
 const {page,context}=load('provider-profile',{'cloud-catalog':{saveDraft:()=>{writes++;throw Error('preview must not save');}}});
 page.data.remoteEnabled=true;page.data.remoteDraftVersion=3;page.savedDraft=original;page.buildDraftValue=()=>edited;page.openDraftPreview=(draft,version,visitor)=>{preview={draft,version,visitor};};
 context.wx.showModal=options=>options.success({confirm:true});await page.previewSaved();
 assert.equal(writes,0);assert.equal(preview.draft.profile.bio,'原内容');assert.notEqual(preview.draft,original);assert.equal(preview.version,3);assert.equal(preview.visitor,true);assert.equal(page.data.saving,false);
});

test('service deletion confirmation targets original service and rejects stale or busy editors',async()=>{
 for(const state of ['normal','reordered','changed','version','saving','unloaded','cancel','failure']){
  let modal,calls=0;const {page,context}=load('provider-profile');const a={id:'a'},b={id:'b'};page.data.serviceDrafts=[a,b];page.data.remoteDraftVersion=2;
  context.wx.showModal=value=>{modal=value;};page.persistDraft=async()=>{calls++;return state!=='failure';};page.returnToManage=()=>{};page.refreshDerived=()=>{};
  page.deleteService({currentTarget:{dataset:{index:0}}});
  if(state==='version')page.data.remoteDraftVersion=3;if(state==='reordered')page.data.serviceDrafts=[b,a];if(state==='changed')page.data.serviceDrafts=[{id:'a',name:'changed'},b];if(state==='saving')page.data.saving=true;if(state==='unloaded')page.unloaded=true;
  await modal.success({confirm:state!=='cancel'});
  assert.equal(calls,['normal','reordered','failure'].includes(state)?1:0,state);
  if(['normal','reordered'].includes(state))assert.deepEqual(Array.from(page.data.serviceDrafts,v=>v.id),['b']);
  if(state==='failure')assert.deepEqual(Array.from(page.data.serviceDrafts,v=>v.id),['a','b']);
 }
});

test('same storefront draft refresh preserves unsaved inputs; changed version reloads',async()=>{
 for(const version of [2,3]){
  const draft={profile:{nickname:'server'},services:[],works:[],pinnedWorkIds:[]};
  const {page}=load('provider-profile',{'cloud-catalog':{getDraft:async()=>({version,providerId:'p',clientDraft:draft}),getProvider:async()=>({provider:{}})}});
  page.serverProviderId='p';page.data.editing=true;page.data.remoteDraftVersion=2;page.data.profileDraft={nickname:'unsaved'};page.refreshDerived=()=>{};page.beginEdit=()=>{page.data.profileDraft={nickname:'server'};};
  page.loadCloudEditor();await new Promise(r=>setImmediate(r));assert.equal(page.data.profileDraft.nickname,version===2?'unsaved':'server');
 }
});

test('older storefront read cannot roll back a saved draft or display a late error',async()=>{
 for(const state of ['saved','saving'])for(const failed of [false,true]){
  let resolve,reject;const {page}=load('provider-profile',{'cloud-catalog':{getDraft:()=>new Promise((a,b)=>{resolve=a;reject=b;}),getProvider:async()=>({provider:{}})}});
  page.data.remoteDraftVersion=2;page.serverProviderId='p';page.data.editing=true;page.refreshDerived=()=>{};page.beginEdit=()=>{page.data.profileDraft={nickname:'old'};};page.loadCloudEditor();
  page.data.profileDraft={nickname:'current'};if(state==='saved')page.data.remoteDraftVersion=3;else page.data.saving=true;
  if(failed)reject({code:'OFFLINE'});else resolve({version:2,providerId:'p',clientDraft:{profile:{nickname:'old'},services:[],works:[]}});
  await new Promise(r=>setImmediate(r));assert.equal(page.data.remoteDraftVersion,state==='saved'?3:2);assert.equal(page.data.profileDraft.nickname,'current');assert.equal(page.data.cloudError,'');assert.equal(page.data.cloudLoading,false);
 }
});

test('storefront transport failure retains edits and retries; business errors remain blocking',async()=>{
 for(const code of [null,'ACCOUNT_NOT_READY']){
  let failing=true;const {page}=load('provider-profile',{'cloud-catalog':{getDraft:async()=>{if(failing){const e=Error('offline');if(code)e.code=code;throw e;}return {version:2,providerId:'p',clientDraft:{profile:{nickname:'saved'},services:[],works:[]}};},getProvider:async()=>({provider:{}})}});
  page.serverProviderId='p';page.data.editing=true;page.data.remoteDraftVersion=2;page.data.profile={nickname:'saved'};page.data.profileDraft={nickname:'unsaved'};page.refreshDerived=()=>{};
  page.loadCloudEditor();await new Promise(r=>setImmediate(r));assert.equal(page.data.profileDraft.nickname,'unsaved');assert.equal(page.data.cloudLoading,false);
  if(code){assert.notEqual(page.data.cloudError,'');assert.equal(page.data.refreshError,'');}else{assert.equal(page.data.cloudError,'');assert.notEqual(page.data.refreshError,'');}
  failing=false;page.retryCloudLoad();await new Promise(r=>setImmediate(r));assert.equal(page.data.cloudError,'');assert.equal(page.data.refreshError,'');assert.equal(page.data.profileDraft.nickname,'unsaved');
 }
});


test('management readiness identifies missing sections without restoring a work-count gate',()=>{
 const {context}=load('provider-profile');const profile={nickname:'创作者',career:'摄影',cityCode:'310000'},service={name:'拍摄',description:'人像',unit:'次',price:100,serviceMode:'ONSITE'};
 for(const [p,services,works,expected] of [
  [profile,[service],[],[true,true,true,true]],
  [{...profile,cityCode:''},[service],[],[false,true,true,false]],
  [profile,[],[],[true,false,true,false]],
  [profile,[{...service,price:0}],[],[true,false,true,false]],
  [profile,[service],[{title:'未完成',description:'',price:100,imagePreviews:['image']}],[true,true,false,false]]
 ]){const r=context.publicationReadiness(p,services,works);assert.deepEqual([r.profileReady,r.servicesReady,r.worksReady,r.ready],expected);assert.equal(context.canPublish(p,services,works),r.ready);}
});

test('management section entry opens an independent list and ignores busy or obsolete taps',()=>{
 const {page,context}=load('provider-profile');const scrolls=[];context.wx.pageScrollTo=options=>scrolls.push(options.scrollTop);
 for(const tab of ['services','works']){page.openManagementTab({currentTarget:{dataset:{tab}}});assert.equal(page.data.profileTab,tab);}
 assert.deepEqual(scrolls,[0,0]);
 page.data.saving=true;page.openManagementTab({currentTarget:{dataset:{tab:'services'}}});page.data.saving=false;page.unloaded=true;page.openManagementTab({currentTarget:{dataset:{tab:'services'}}});assert.equal(scrolls.length,2);
});


test('work editor moves one work between services, preserves other works and saves association with draft',async()=>{
 let saved;const {page,context}=load('provider-profile',{'cloud-catalog':{saveDraft:async(version,draft)=>{saved=draft;return {version:2};}}});context.wx.navigateBack=()=>{};
 page.data.profileDraft={nickname:'作者',career:'摄影',cityCode:'310000'};page.data.remoteEnabled=true;
 page.data.workDrafts=[{id:'w',title:'作品',description:'正文',price:100,imagePreviews:['image']},{id:'other',title:'其他作品',description:'正文',price:100,imagePreviews:['other-image']}];
 page.data.serviceDrafts=[{id:'a',name:'服务A',description:'说明',unit:'次',price:100,serviceMode:'ONSITE',workIds:['w','other']},{id:'b',name:'服务B',description:'说明',unit:'次',price:200,serviceMode:'ONSITE',workIds:[]}];
 page.refreshDerived();assert.equal(page.data.workServiceIndex,1);
 page.chooseWorkService({detail:{value:'2'}});assert.deepEqual(Array.from(page.data.serviceDrafts[0].workIds),['other']);assert.deepEqual(Array.from(page.data.serviceDrafts[1].workIds),['w']);assert.equal(page.data.workServiceIndex,2);
 await page.saveWork();assert.deepEqual(Array.from(saved.services[1].workIds),['w']);
 page.chooseWorkService({detail:{value:'0'}});assert.deepEqual(Array.from(page.data.serviceDrafts[1].workIds),[]);assert.deepEqual(Array.from(page.data.serviceDrafts[0].workIds),['other']);
 const before=JSON.stringify(page.data.serviceDrafts);page.data.saving=true;page.chooseWorkService({detail:{value:'1'}});page.data.saving=false;page.chooseWorkService({detail:{value:'999'}});assert.equal(JSON.stringify(page.data.serviceDrafts),before);
 page.unloaded=true;page.chooseWorkService({detail:{value:'1'}});assert.equal(JSON.stringify(page.data.serviceDrafts),before);
});

test('cancel work editor discards service-selection changes without saving',()=>{
 let saves=0;const {page,context}=load('provider-profile',{'cloud-catalog':{saveDraft:()=>{saves++;}},'storefront-preview-draft':{clear(){}}});context.wx.navigateBack=()=>{};page.clearPendingFiles=()=>{};
 page.data.editorSection='works';page.data.workDrafts=[{id:'w',title:'作品',description:'正文',price:100,imagePreviews:['image']}];page.data.serviceDrafts=[{id:'a',name:'服务',description:'说明',unit:'次',price:100,serviceMode:'ONSITE',workIds:[]}];page.refreshDerived();page.chooseWorkService({detail:{value:'1'}});page.cancelEdit();assert.equal(saves,0);assert.equal(page.data.editing,false);
});


test('work image batch waits for all files, retains success and latest edits, and blocks conflicting actions',async()=>{
 const {page}=load('provider-profile');let finish,saves=0,removals=0,cleanups=0;
 page.data.profileDraft={};page.data.workDrafts=[{id:'w',title:'原标题',description:'正文',price:100,imagePreviews:['old'],imageAssetIds:['old-id'],mediaStatuses:['READY']}];
 page.saveSelectedFile=file=>file.fail?Promise.reject(Error('offline')):new Promise(resolve=>{finish=resolve;});page.persistDraft=async()=>{saves++;return true;};page.removePendingFile=()=>{removals++;};page.clearPendingFiles=()=>{cleanups++;};
 const task=page.uploadWorkImages([{fail:true},{fail:false}],'w');await new Promise(r=>setImmediate(r));assert.equal(page.data.uploadingImages,true);
 await page.saveWork();page.cancelEdit();assert.equal(saves,0);assert.equal(removals,0);assert.equal(cleanups,0);
 page.data.workDrafts[0]={...page.data.workDrafts[0],title:'上传中修改的标题'};
 finish({preview:'new',assetId:'new-id',status:'PENDING_SECURITY_REVIEW'});await task;
 assert.equal(page.data.uploadingImages,false);assert.equal(page.data.workDrafts[0].title,'上传中修改的标题');assert.deepEqual(Array.from(page.data.workDrafts[0].imagePreviews),['old']);assert.equal(page.data.pendingImagePreviews[1].state,'上传完成');assert.match(page.data.editorError,/1 张图片上传失败/);
 page.saveSelectedFile=async()=>({preview:'retry',assetId:'retry-id',status:'READY'});page.refreshDerived();await page.retryWorkImages();assert.deepEqual(Array.from(page.data.workDrafts[0].imagePreviews),['old','retry','new']);assert.equal(page.data.editorError,'');
});

test('work image completion after leaving cannot update the former editor',async()=>{
 const {page}=load('provider-profile');let finish,writes=0;page.data.workDrafts=[{id:'w',imagePreviews:[]}];page.saveSelectedFile=()=>new Promise(resolve=>{finish=resolve;});
 const task=page.uploadWorkImages([{}],'w');page.unloaded=true;page.setData=()=>{writes++;};finish({preview:'late',assetId:'late-id',status:'READY'});await task;assert.equal(writes,0);
});

test('work upload prevents refresh and retires earlier reads even when they finish after upload',async()=>{
 for(const failed of [false,true]){
  let resolveRead,rejectRead,finishUpload,reads=0,rebuilt=0;
  const {page}=load('provider-profile',{'cloud-catalog':{getDraft:()=>{reads++;return new Promise((resolve,reject)=>{resolveRead=resolve;rejectRead=reject;});}}});
  page.data.remoteDraftVersion=2;page.data.workDrafts=[{id:'w',title:'当前文字',imagePreviews:[]}];page.refreshDerived=()=>{};page.beginEdit=()=>{rebuilt++;};
  page.loadCloudEditor();page.saveSelectedFile=()=>new Promise(resolve=>{finishUpload=resolve;});
  const upload=page.uploadWorkImages([{}],'w');page.loadCloudEditor();assert.equal(reads,1);assert.equal(page.data.cloudLoading,false);
  finishUpload({preview:'new-image',assetId:'new-asset',status:'READY'});await upload;
  if(failed)rejectRead({code:'OFFLINE'});else resolveRead({version:3,providerId:'p',clientDraft:{profile:{},services:[],works:[]}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(rebuilt,0);assert.equal(page.data.remoteDraftVersion,2);assert.equal(page.data.cloudError,'');
  assert.deepEqual(Array.from(page.data.workDrafts[0].imagePreviews),['new-image']);assert.equal(page.data.workDrafts[0].title,'当前文字');
  page.loadCloudEditor();assert.equal(reads,2);rejectRead(Error('offline'));await new Promise(resolve=>setImmediate(resolve));assert.equal(page.data.cloudLoading,false);
 }
});

test('notice image replacement retains old content on failure and blocks save, cancel and duplicate uploads',async()=>{
 for(const outcome of ['success','failure','unloaded']){
  let picker,resolveUpload,rejectUpload,picks=0,saves=0,returns=0,writes=0;const removed=[];
  const {page}=load('provider-profile',{'work-media-picker':{chooseImageMedia:options=>{picks++;picker=options;}}});
  page.data.noticeImageDraft='old';page.data.noticeImageAssetId='old-id';page.data.profileDraft={notice:'须知正文'};
  page.saveSelectedFile=()=>new Promise((resolve,reject)=>{resolveUpload=resolve;rejectUpload=reject;});page.removePendingFile=path=>removed.push(path);page.persistDraft=async()=>{saves++;return true;};page.returnToManage=()=>{returns++;};
  page.chooseNoticeImage();const upload=picker.success({tempFiles:[{}]});assert.equal(page.data.uploadingImages,true);
  page.chooseNoticeImage();await page.saveSection();page.cancelSection();assert.equal(picks,1);assert.equal(saves,0);assert.equal(returns,0);
  if(outcome==='unloaded'){page.unloaded=true;page.setData=()=>{writes++;};}
  if(outcome==='failure')rejectUpload(Error('offline'));else resolveUpload({preview:'new',assetId:'new-id'});await upload;
  assert.equal(page.data.profileDraft.notice,'须知正文');assert.equal(page.data.noticeImageDraft,outcome==='success'?'new':'old');assert.deepEqual(removed,outcome==='success'?['old']:[]);
  if(outcome==='unloaded')assert.equal(writes,0);else{assert.equal(page.data.uploadingImages,false);assert.equal(Boolean(page.data.editorError),outcome==='failure');}
 }
});

test('saving locks editable fields and failed save restores editing without accepting late input',async()=>{
 let rejectSave;const {page}=load('provider-profile',{'cloud-catalog':{saveDraft:()=>new Promise((resolve,reject)=>{rejectSave=reject;})}});
 page.data.remoteEnabled=true;page.data.profileDraft={notice:'原文'};page.data.workDrafts=[{id:'w',title:'原作品',description:'正文',price:100,imageAssetIds:[]}];page.data.serviceDrafts=[];page.buildDraftValue=()=>({profile:{notice:'原文'},works:[],services:[]});
 const saving=page.persistDraft();const before=JSON.stringify(page.data);
 const event={currentTarget:{dataset:{key:'notice',index:0}},detail:{value:'保存期间输入'}};
 for(const method of ['updateProfile','updateProfileRegion','updateCareer','updateService','updateServiceMode','addServiceArea','removeServiceArea','updateWork','updateAccepting'])page[method](event);
 page.applyServiceWorks(0,['w']);assert.equal(JSON.stringify(page.data),before);
 rejectSave(Error('offline'));assert.equal(await saving,false);assert.equal(page.data.saving,false);
 page.data.uploadingImages=true;let patch;page.setData=value=>{patch=value;};page.updateProfile(event);assert.equal(patch['profileDraft.notice'],'保存期间输入');
 const markup=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/provider-profile/index.wxml'),'utf8');
 for(const tag of markup.match(/<(?:input|textarea|picker)\b[^>]*>/g))assert.match(tag,/disabled="{{[^}]*saving/);
});

test('direct work edit and pin actions reject unavailable work or busy pages and restore failed saves',async()=>{
 for(const state of ['normal','removed','saving','loading','unloaded','pinned','limit','save-failed']){
  let opened=0,saved=0;const {page,context}=load('provider-profile');
  page.data.workDrafts=[{id:'w'}];page.data.pinnedDraft=state==='pinned'?['w']:state==='limit'?['x','y']:[];
  context.wx.navigateTo=()=>opened++;page.persistDraft=async()=>{saved++;return state!=='save-failed';};page.refreshDerived=()=>{};
  if(state==='removed')page.data.workDrafts=[];
  if(state==='saving')page.data.saving=true;if(state==='loading')page.data.cloudLoading=true;if(state==='unloaded')page.unloaded=true;
  const before=JSON.stringify(page.data.pinnedDraft),blocked=['removed','saving','loading','unloaded'].includes(state);
  const event={currentTarget:{dataset:{id:'w'}}};page.openWorkEditor(event);page.togglePortfolioPin(event);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(opened,blocked?0:1,state);assert.equal(saved,blocked||state==='limit'?0:1,state);
  assert.equal(JSON.stringify(page.data.pinnedDraft),blocked||['limit','save-failed'].includes(state)?before:state==='pinned'?'[]':'["w"]',state);
  page.unloaded=false;page.data.saving=false;page.data.cloudLoading=false;
  const missing={currentTarget:{dataset:{id:'missing'}}},counts=[opened,saved];
  page.openWorkEditor(missing);page.togglePortfolioPin(missing);
  assert.deepEqual([opened,saved],counts);assert.equal(page.data.pinnedDraft.includes('missing'),false);
 }
});

test('missing existing work never becomes a new upload; explicit creation and retry of restored work still work',()=>{
 const {page}=load('provider-profile');let consumed=0;page.consumeEntryUpload=()=>{consumed++;};page.refreshDerived=()=>{};
 page.data.editorSection='works';page.data.profile={nickname:'作者'};page.data.works=[];page.data.services=[];page.data.pinnedWorkIds=[];page.requestWorkId='missing';page.data.workSaveComplete=true;
 page.beginEdit();assert.equal(page.data.editing,false);assert.equal(page.data.isNewWork,false);assert.equal(page.data.selectedWork,null);assert.equal(page.data.workDrafts.length,0);assert.equal(page.data.workSaveComplete,false);assert.equal(consumed,0);assert.match(page.data.cloudError,/不在当前橱窗草稿/);
 page.data.cloudError='';page.data.works=[{id:'missing',title:'恢复的作品'}];page.beginEdit();assert.equal(page.data.editing,true);assert.equal(page.data.isNewWork,false);assert.equal(page.data.selectedWork.id,'missing');assert.equal(consumed,0);
 page.requestWorkId='';page.beginEdit();assert.equal(page.data.isNewWork,true);assert.equal(page.data.workDrafts.length,2);assert.notEqual(page.data.selectedWork.id,'missing');assert.equal(consumed,1);
});

test('manager navigation and new service cannot change a saving or refreshing editor',()=>{
 for(const state of ['saving','cloudLoading','unloaded']){
  const {page,context}=load('provider-profile');let navigation=0;context.wx.navigateTo=()=>{navigation++;};page.buildDraftValue=()=>{throw Error('must not replace edit snapshot');};
  if(state==='unloaded')page.unloaded=true;else page.data[state]=true;
  const before=JSON.stringify(page.data);page.addService();page.openAccount();page.openCalendar();page.openSection({currentTarget:{dataset:{section:'profile'}}});page.chooseProfileTab({currentTarget:{dataset:{tab:'services'}}});
  assert.equal(JSON.stringify(page.data),before);assert.equal(navigation,0);assert.equal(page.accountOpen,undefined);
 }
});

test('returning account data applies only to the current storefront and latest live read',async()=>{
 for(const state of ['normal','unloaded','provider','new-read','wrong-account','error','late-error']){
  let resolve,reject;const {page}=load('provider-profile',{'cloud-account':{getMine:()=>new Promise((a,b)=>{resolve=a;reject=b;})}});
  page.accountOpen=true;page.serverProviderId='p';page.refreshDerived=()=>{};page.onShow();let writes=0;const setData=page.setData;page.setData=value=>{writes++;setData(value);};
  if(state==='unloaded'||state==='late-error')page.unloaded=true;if(state==='provider')page.serverProviderId='other';if(state==='new-read')page.editorReadSequence++;
  if(state.includes('error'))reject(Error('offline'));else resolve({id:state==='wrong-account'?'other':'p',nickname:'更新昵称',avatarUrl:'avatar'});
  await new Promise(done=>setImmediate(done));assert.equal(writes,['normal','error'].includes(state)?1:0,state);
  if(state==='normal')assert.equal(page.data.accountNickname,'更新昵称');if(state==='error')assert.match(page.data.editorError,/回读失败/);
 }
});

test('uploads completing after departure request cleanup instead of adding assets to the abandoned draft',async()=>{
 for(const status of ['REJECTED','READY','PENDING_SECURITY_REVIEW','local'])for(const departed of [true,false]){
  const remote=status!=='local';
  let complete;const cancelled=[];const {page,context}=load('provider-profile',{'cloud-catalog':{uploadImage:()=>new Promise(resolve=>{complete=resolve;}),cancelImage:async(id,file)=>{cancelled.push([id,file]);throw Error('cleanup unavailable');}}});
  page.data.remoteEnabled=remote;page.pendingCloudAssets=[];page.pendingSavedFiles=[];context.wx.saveFile=options=>{complete=value=>options.success({savedFilePath:value});};context.wx.removeSavedFile=options=>cancelled.push(options.filePath);
  const upload=page.saveSelectedFile({tempFilePath:'temp'},'notice');page.unloaded=departed;const result=remote?{assetId:'new-asset',fileId:'new-file',preview:'temp',status}:'saved-file';complete(result);assert.equal(await upload,result);await new Promise(done=>setImmediate(done));
  assert.equal(cancelled.length,departed && (!remote || status==='REJECTED')?1:0);assert.equal(page.pendingCloudAssets.length+page.pendingSavedFiles.length,departed?0:1);
  if(cancelled.length)assert.deepEqual(cancelled[0],remote?['new-asset','new-file']:'saved-file');
 }
});

test('unavailable image keeps its slot so removing a visible image removes the correct asset and status',()=>{
 const draft=catalogClient.toClientDraft({profile:{},services:[],works:[{id:'w',title:'作品',description:'正文',priceFen:100,imageAssetIds:['missing','visible']}],pinnedWorkIds:[]},{nickname:'作者'},[{assetId:'visible',tempFileURL:'visible-url',status:'READY'}]);
 assert.deepEqual(draft.works[0].imagePreviews,['','visible-url']);
 const {page}=load('provider-profile');page.data.workDrafts=draft.works;page.removePendingFile=()=>{};page.refreshDerived();
 assert.deepEqual(Array.from(page.data.workImageSlots,slot=>slot.id),['missing','visible']);assert.equal(page.data.workImageSlots[1].status,'READY');
 page.removeWorkImage({currentTarget:{dataset:{index:1}}});assert.deepEqual(Array.from(page.data.workDrafts[0].imageAssetIds),['missing']);assert.deepEqual(Array.from(page.data.workDrafts[0].imagePreviews),['']);
 page.removeWorkImage({currentTarget:{dataset:{index:0}}});assert.equal(page.data.workDrafts[0].imageAssetIds.length,0);assert.equal(page.data.workImageSlots.length,0);
});


test('confirmed work save returns to its original manager once; failed navigation leaves a recoverable saved state',async()=>{
 const {page,context}=load('provider-profile');let saves=0,backs=0,redirects=[];page.data.workDrafts=[{id:'w',title:'作品'}];page.persistDraft=async()=>{saves++;return true;};context.wx.navigateBack=()=>{backs++;};context.wx.redirectTo=options=>redirects.push(options.url);
 context.getCurrentPages=()=>[{route:'pages/provider-profile/index',data:{editorSection:'profile'}},{route:'pages/provider-profile/index'}];
 await page.saveWork();assert.equal(page.data.workSaveComplete,true);assert.equal(backs,1);assert.deepEqual(redirects,[]);assert.equal(page.requestWorkId,'w');
 await page.saveWork();assert.equal(saves,1);assert.equal(backs,1);
 context.getCurrentPages=()=>[{route:'pages/discover/index',data:{}},{route:'pages/provider-profile/index'}];page.manageSavedWork();assert.equal(redirects[0],'/pages/provider-profile/index?edit=1&section=profile');
 page.unloaded=true;page.manageSavedWork();assert.equal(redirects.length,1);
});

test('failed work save stays in editor and cannot open the saved-result destination',async()=>{
 const {page,context}=load('provider-profile');page.data.workDrafts=[{id:'w',title:'作品',description:'正文',price:100,imagePreviews:['image']}];page.persistDraft=async()=>false;context.wx.redirectTo=()=>assert.fail('failed save cannot navigate');
 await page.saveWork();assert.equal(page.data.workSaveComplete,false);page.manageSavedWork();assert.equal(page.requestWorkId,undefined);
});


test('publication checklist lists every incomplete entity and routes to its existing editor',()=>{
 const {page,context}=load('provider-profile');page.data.profileDraft={nickname:'',career:'',cityCode:''};page.data.serviceDrafts=[{id:'s1',name:'摄影',description:'',unit:'次',price:0,serviceMode:'ONSITE'},{id:'s2',name:'',description:'',unit:'',price:0,serviceMode:'ONSITE'}];page.data.workDrafts=[{id:'w1',title:'照片',description:'',price:100,imagePreviews:[]},{id:'w2',title:'',description:'',price:0,imagePreviews:[]}];
 const issues=context.publicationReadiness(page.data.profileDraft,page.data.serviceDrafts,page.data.workDrafts).issues;assert.deepEqual(Array.from(issues,i=>i.key),['nickname','profile','service-s1','service-s2','work-w1','work-w2']);assert.match(issues[2].label,/描述、有效价格/);assert.match(issues[4].label,/描述、图片/);
 const calls=[];page.openAccount=()=>calls.push('account');page.openSection=e=>calls.push(e.currentTarget.dataset.section);page.toggleServiceEditor=e=>calls.push(e.currentTarget.dataset.id);page.openWorkEditor=e=>calls.push(e.currentTarget.dataset.id);page.addService=()=>calls.push('new-service');
 for(const i of issues)page.fixPublicationIssue({currentTarget:{dataset:{key:i.key}}});assert.deepEqual(calls,['account','profile','s1','s2','w1','w2']);
 page.data.serviceDrafts=[];page.fixPublicationIssue({currentTarget:{dataset:{key:'new-service'}}});assert.equal(calls.at(-1),'new-service');
 const before=calls.length;page.fixPublicationIssue({currentTarget:{dataset:{key:'service-s1'}}});page.data.saving=true;page.fixPublicationIssue({currentTarget:{dataset:{key:'nickname'}}});assert.equal(calls.length,before);
});


test('service name rejection and unavailable review remain actionable in save-preview and publish',async()=>{
 for(const code of ['SERVICE_NAME_REJECTED','SERVICE_NAME_CHECK_UNAVAILABLE']){
  const message=code==='SERVICE_NAME_REJECTED'?'服务名称未通过审核，请修改后重试。':'服务名称审核暂不可用，请稍后重试。';
  let opened=0,marked=0;
  const {page:editor}=load('provider-profile',{'cloud-catalog':{saveDraft:async()=>{throw {code,message};}}});
  editor.data.remoteEnabled=true;editor.openDraftPreview=()=>opened++;
  await editor.persistDraft({profile:{},services:[],works:[]});
  assert.equal(editor.data.editorError,message);assert.equal(editor.data.saving,false);assert.equal(opened,0);
  const draft={providerId:'provider',draftVersion:2};
  const {page}=load('provider-detail',{'storefront-preview-draft':{get:()=>draft,markPublished:()=>marked++},'cloud-catalog':{publishDraft:async()=>{throw {code,message};}}});
  page.data.provider={id:'provider'};page.data.storefrontDraftPreview=true;page.auditMode=false;page.publicationDraft=draft;
  page.confirmPublish();await new Promise(resolve=>setImmediate(resolve));
  assert.match(page.data.publishError,code==='SERVICE_NAME_REJECTED'?/公开文字.*检查/:/检测暂不可用/);
  assert.equal(page.data.publishing,false);assert.equal(page.data.previewPublished,false);assert.equal(marked,0);
 }
});
