const test = require('node:test');
const assert = require('node:assert/strict');
const cloudCatalog = require('../miniprogram/services/cloud-catalog');
const { normalizeDraft } = require('../cloudfunctions/provider-catalog-draft/draft-core');
const storage = new Map();
global.wx = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), showToast() {}, pageScrollTo() {}, navigateBack() {}, navigateTo() {}, removeSavedFile() {} };
let editorDefinition, detailDefinition;
global.Page = value => { editorDefinition = value; };
require('../miniprogram/pages/provider-profile/index');
global.Page = value => { detailDefinition = value; };
require('../miniprogram/pages/provider-detail/index');
delete global.Page;
function page(definition) {
  const p = { data: structuredClone(definition.data), auditMode: true, pendingSavedFiles: [], pendingCloudAssets: [] };
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') p[key] = value.bind(p);
  p.setData = (patch, callback) => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = p.data;
      while (parts.length > 1) target = target[parts.shift()];
      target[parts[0]] = value;
    }
    if (callback) callback();
  };
  return p;
}
function draft() {
  return { career: '妆娘', profile: { nickname: '创作者', career: '妆娘', city: '杭州', cityCode: '330100', district: '余杭区', bio: '简介', tags: '自然', notice: '请提前沟通', accepting: false, specialties: '自然妆', declines: '特效妆', contactHours: '18:00–22:00' }, services: [{ id: 's1', name: '跟妆', price: 360, unit: '次', description: '4小时跟妆', includes: '补妆', extras: '交通另议', preparation: '素颜', serviceMode: 'ONSITE', serviceAreas: [], workIds: ['w1'] }], works: [{ id: 'w1', title: '作品', subtitle: '副标题', description: '正文', price: 680, imageAssetIds: ['image1'], imagePreviews: ['local-image'], tags: ['自然'], referenceCount: 3 }], pinnedWorkIds: [], noticeImageAssetId: 'notice1', noticeImage: 'notice-image' };
}
function editor() {
  const p = page(editorDefinition), value = draft();
  Object.assign(p.data, { career: value.career, accountNickname: value.profile.nickname, profile: value.profile, services: value.services, works: value.works, pinnedWorkIds: [], noticeImage: value.noticeImage, noticeImageAssetId: value.noticeImageAssetId });
  p.beginEdit();
  return p;
}
const event = dataset => ({ currentTarget: { dataset } });
test('单作品草稿预览保留真实作者与作品参数', async t => {
  const p = editor();
  p.auditMode = false;
  p.serverProviderId = 'author_real';
  p.savedDraft = p.buildDraftValue();
  p.data.selectedWork = p.data.works[0];
  let url;
  t.mock.method(wx, 'navigateTo', options => { url = options.url; });
  await p.previewSelectedWork();
  assert.equal(url, '/pages/work-detail/index?id=w1&providerId=author_real&workspace=provider&preview=storefront');
  require('../miniprogram/data/storefront-preview-draft').clear();
});
test('完整资料和服务说明经客户端→服务端规范化→客户端保持一致', () => {
  const original = draft(), server = normalizeDraft(cloudCatalog.toServerDraft(original));
  const client = cloudCatalog.toClientDraft(server, { nickname: '创作者', uid: 'u1' }, []);
  for (const key of ['district','accepting','specialties','declines','contactHours']) assert.equal(client.profile[key], original.profile[key]);
  for (const key of ['includes','extras','preparation']) assert.equal(client.services[0][key], original.services[0][key]);
  assert.equal(client.services[0].price, 360); assert.equal(client.works[0].price, 680);
  assert.equal(server.profile.nickname, undefined); assert.equal(server.profile.rating, undefined);
});
test('旧草稿兼容接单状态，新草稿拒绝伪造状态和超长说明', () => {
  const value = cloudCatalog.toServerDraft(draft()); delete value.profile.accepting;
  assert.equal(normalizeDraft(value).profile.accepting, true);
  value.profile.accepting = 'false'; assert.throws(() => normalizeDraft(value), /boolean/);
  value.profile.accepting = false; value.services[0].extras = '长'.repeat(1001);
  assert.throws(() => normalizeDraft(value), /too long/);
});
test('取消独立资料与新服务编辑恢复已保存值', () => {
  const p = editor(); p.openSection(event({ section: 'profile' }));
  p.updateProfile({ ...event({ key: 'bio' }), detail: { value: '未保存简介' } });
  p.cancelSection(); assert.equal(p.data.profileDraft.bio, '简介'); assert.equal(p.data.editorView, 'manage');
  p.addService(); assert.equal(p.data.serviceDrafts.length, 2); p.cancelSection(); assert.equal(p.data.serviceDrafts.length, 1);
});
test('关联作品弹层取消不改变关联，外层取消恢复服务描述', () => {
  const p = editor(); p.toggleServiceEditor(event({ id: 's1' })); p.openWorkPicker(event({ index: 0 }));
  p.toggleWorkPickerWork(event({ id: 'w1' })); p.closeWorkPicker(); assert.deepEqual(p.data.serviceDrafts[0].workIds, ['w1']);
  p.updateService({ ...event({ index: 0, key: 'extras' }), detail: { value: '未保存' } });
  p.cancelSection(); assert.equal(p.data.serviceDrafts[0].extras, '交通另议');
});
test('关联占用不可选，直接确认也不会静默转移其他服务的作品', () => {
  const p = editor(); p.data.workDrafts.push({ id: 'w2', title: '另一作品', description: '正文', price: 20, imagePreviews: ['image'], tags: [] });
  p.data.serviceDrafts.push({ id: 's2', name: '其他服务', workIds: ['w2'] });
  p.openWorkPicker(event({ index: 0 }));
  assert.equal(p.data.workPickerOptions.find(work => work.id === 'w2').occupied, true);
  p.toggleWorkPickerWork(event({ id: 'w2' })); assert.deepEqual(p.data.workPickerDraftIds, ['w1']);
  p.applyServiceWorks(0, ['w1', 'w2']); assert.deepEqual(p.data.serviceDrafts[1].workIds, ['w2']); assert.deepEqual(p.data.serviceDrafts[0].workIds, ['w1']);
});
test('保存草稿可重建页面，取消不会回滚已保存资料或公开发布', async () => {
  const p = editor(); p.openSection(event({ section: 'profile' }));
  p.updateProfile({ ...event({ key: 'bio' }), detail: { value: '已保存简介' } }); await p.saveSection();
  const saved = storage.get('animeMasterCreatorAuditDraft'); assert.equal(saved.profile.bio, '已保存简介');
  const next = editor(); next.loadPublished(); next.beginEdit(); assert.equal(next.data.profileDraft.bio, '已保存简介');
  next.openSection(event({ section: 'notice' })); next.updateProfile({ ...event({ key: 'notice' }), detail: { value: '未保存须知' } }); next.cancelSection();
  assert.equal(next.data.profileDraft.notice, '请提前沟通'); assert.equal(next.data.profileDraft.bio, '已保存简介');
  storage.delete('animeMasterCreatorAuditDraft');
});
test('云端保存失败保留输入与版本，重试成功才退出编辑', async t => {
  const p = editor(); p.data.remoteEnabled = true; p.data.remoteDraftVersion = 4; p.openSection(event({ section: 'profile' }));
  p.updateProfile({ ...event({ key: 'bio' }), detail: { value: '重试内容' } });
  let fail = true; t.mock.method(cloudCatalog, 'saveDraft', async (version, value) => { assert.equal(version, 4); assert.equal(value.profile.bio, '重试内容'); if (fail) throw Error('network'); return { version: 5 }; });
  await p.saveSection(); assert.equal(p.data.editorView, 'profile'); assert.equal(p.data.profileDraft.bio, '重试内容'); assert(p.data.editorError); assert.equal(p.data.saving, false);
  fail = false; await p.saveSection(); assert.equal(p.data.editorView, 'manage'); assert.equal(p.data.remoteDraftVersion, 5);
});
test('访客选择跨分页保留，预约合计使用服务价格，暂停接单不选中', () => {
  const value = draft(), p = page(detailDefinition); p.providerPreview = false;
  const provider = { id: 'p1', name: '创作者', city: '杭州', career: '妆娘', orders: 0, rating: null };
  value.profile.accepting = true;
  p.loadProvider({}, provider, value); assert.deepEqual(p.data.selectedServiceIds, []);
  p.toggleService(event({ id: 's1' })); assert.equal(p.data.selectedTotal, 360);
  p.chooseProfileTab(event({ tab: 'schedule' })); assert.deepEqual(p.data.selectedServiceIds, ['s1']); assert.equal(p.data.provider.works[0].price, 680);
  value.profile.accepting = false; p.loadProvider({ services: 's1' }, provider, value); assert.equal(p.data.selectedTotal, 0); p.toggleService(event({ id: 's1' })); assert.deepEqual(p.data.selectedServiceIds, []);
});
test('未完成服务可保存草稿并返回服务列表，发布检查仍提示缺项', async () => {
  const p = editor(); p.addService(); await p.saveSection(); assert.equal(p.data.editorView, 'manage'); assert.equal(p.data.managementTab, 'services'); assert.equal(p.savedDraft.services.length, 2);
});
test('输入金额在保存预览前转成数值，不发生字符串拼接', () => {
  const p = editor(); p.data.serviceDrafts[0].price = '360.50'; p.data.workDrafts[0].price = '680';
  const saved = p.buildDraftValue();
  assert.equal(saved.services[0].price, 360.5); assert.equal(saved.works[0].price, 680);
  assert.equal(saved.profile.servicePrice, 360.5);
});

test('管理入口切独立列表而不是滚到同页锚点，返回恢复原位置', t => {
  const p=editor(), scrolls=[]; t.mock.method(wx,'pageScrollTo',options=>scrolls.push(options));
  p.editorScrollTop=120; p.openManagementTab(event({tab:'services'}));
  assert.equal(p.data.managementTab,'services'); assert.equal(p.data.navTitle,'服务项目'); assert.deepEqual(scrolls.pop(),{scrollTop:0,duration:0});
  p.editorScrollTop=240; p.toggleServiceEditor(event({id:'s1'})); p.cancelSection();
  assert.equal(p.data.navTitle,'服务项目'); assert.equal(scrolls.pop().scrollTop,240);
  p.navigateEditorBack(); assert.equal(p.data.managementTab,''); assert.equal(scrolls.pop().scrollTop,120);
});
test('长说明完成只回填同一对象，不保存；返回恢复原位置', t => {
  const p=editor(), scrolls=[];t.mock.method(wx,'pageScrollTo',options=>scrolls.push(options));
  p.toggleServiceEditor(event({id:'s1'}));p.editorScrollTop=170;
  p.openTextEditor(event({scope:'service',key:'description',title:'详细描述',max:1000}));
  p.updateEditorText({detail:{value:'新的范围说明'}});
  assert.equal(p.data.serviceDrafts[0].description,'4小时跟妆');
  p.finishTextEditor();assert.equal(p.data.serviceDrafts[0].description,'新的范围说明');assert.equal(p.data.services[0].description,'4小时跟妆');
  assert.equal(p.data.textEditor,null);assert.equal(p.data.navTitle,'编辑服务');assert.equal(scrolls.pop().scrollTop,170);
});
test('长文本遇到版本变化或对象替换不能写入新对象',()=>{
  const p=editor();p.toggleServiceEditor(event({id:'s1'}));p.openTextEditor(event({scope:'service',key:'description',title:'详细描述'}));p.updateEditorText({detail:{value:'旧文字'}});
  p.data.remoteDraftVersion++;p.finishTextEditor();assert.equal(p.data.serviceDrafts[0].description,'4小时跟妆');
  p.data.remoteDraftVersion--;p.data.serviceDrafts[0].id='replacement';p.finishTextEditor();assert.equal(p.data.serviceDrafts[0].description,'4小时跟妆');
});
test('未保存分项返回确认取消保留，确认放弃才恢复',t=>{
  const p=editor();let dialog;wx.showModal=options=>{dialog=options};t.after(()=>delete wx.showModal);
  p.openSection(event({section:'profile'}));p.updateProfile({currentTarget:{dataset:{key:'bio'}},detail:{value:'未保存简介'}});p.navigateEditorBack();dialog.success({confirm:false});assert.equal(p.data.profileDraft.bio,'未保存简介');
  p.navigateEditorBack();dialog.success({confirm:true});assert.equal(p.data.profileDraft.bio,'简介');assert.equal(p.data.editorView,'manage');
});
test('键盘只避让完整框体底部并预留16px，不按光标逐字滚动',t=>{
  const p=editor(),scrolls=[];p.editorScrollTop=100;p.keyboardWindowHeight=800;
  t.mock.method(wx,'pageScrollTo',options=>scrolls.push(options));
  wx.createSelectorQuery=()=>{const q={in(){return q},select(id){assert.equal(id,'#field');return q},boundingClientRect(){return q},exec(cb){cb([{top:350,bottom:600}])}};return q};t.after(()=>delete wx.createSelectorQuery);
  p.activeKeyboardField='field';p.changeEditorKeyboard({detail:{height:300}});
  assert.equal(p.data.keyboardInset,300);assert.equal(scrolls[0].scrollTop,216);
  p.updateProfile({currentTarget:{dataset:{key:'bio'}},detail:{value:'输入中'}});assert.equal(scrolls.length,1);
  p.changeEditorKeyboard({detail:{height:0}});assert.equal(p.data.keyboardInset,0);
});
test('键盘迟到测量不推动已关闭字段，无遮挡时不滚动',t=>{
  const p=editor();let reply,scrolls=0;p.keyboardWindowHeight=800;p.activeKeyboardField='field';t.mock.method(wx,'pageScrollTo',()=>scrolls++);
  wx.createSelectorQuery=()=>{const q={in(){return q},select(){return q},boundingClientRect(){return q},exec(cb){reply=cb}};return q};t.after(()=>delete wx.createSelectorQuery);
  p.changeEditorKeyboard({detail:{height:300}});reply([{top:100,bottom:200}]);assert.equal(scrolls,0);
  p.changeEditorKeyboard({detail:{height:320}});p.activeKeyboardField=null;reply([{top:300,bottom:700}]);assert.equal(scrolls,0);
});


test('server-confirmed empty editor opens synchronously without a loading frame or redundant reads', t => {
 const p=page(editorDefinition);p.auditMode=false;
 const draft={profile:{},services:[],works:[],pinnedWorkIds:[]};
 const cached={providerId:'owner',version:0,clientDraft:cloudCatalog.toClientDraft(draft,{id:'owner',nickname:'新用户'},[])};
 t.mock.method(cloudCatalog,'peekDraft',()=>structuredClone(cached));
 let reads=0;t.mock.method(cloudCatalog,'getDraft',()=>{reads++;throw Error('unexpected draft read');});
 t.mock.method(cloudCatalog,'getProvider',()=>{reads++;throw Error('unexpected public read');});
 const updates=[],set=p.setData;p.setData=(patch,callback)=>{updates.push(patch);set(patch,callback);};
 p.loadCloudEditor();
 assert.equal(reads,0);assert.equal(updates.some(update=>update.cloudLoading===true),false);
 assert.equal(p.data.editing,true);assert.equal(p.data.remoteDraftVersion,0);assert.equal(p.serverProviderId,'owner');
 assert.equal(p.data.workDrafts.length,0);assert.equal(p.data.serviceDrafts.length,0);
 p.data.profileDraft.bio='正在编辑';p.loadCloudEditor();
 assert.equal(reads,0);assert.equal(p.data.profileDraft.bio,'正在编辑');
});


test('resident city shortcut fills only the selected service without picker or duplicates',()=>{
 const p=page(editorDefinition);p.data.profileDraft={city:'上海市',cityCode:'310000'};
 p.data.serviceDrafts=[{id:'a',serviceMode:'ONSITE',serviceAreas:[{cityName:'杭州市',cityCode:'330100'}]},{id:'b',serviceMode:'ONLINE',serviceAreas:[]}];
 p.refreshDerived=()=>{};const event={currentTarget:{dataset:{index:0}}};
 p.useResidentCity(event);p.useResidentCity(event);
 assert.deepEqual(p.data.serviceDrafts[0].serviceAreas,[{cityName:'杭州市',cityCode:'330100'},{cityName:'上海市',cityCode:'310000'}]);
 p.useResidentCity({currentTarget:{dataset:{index:1}}});assert.deepEqual(p.data.serviceDrafts[1].serviceAreas,[]);
 p.data.saving=true;p.data.profileDraft={city:'北京市',cityCode:'110000'};p.useResidentCity(event);assert.equal(p.data.serviceDrafts[0].serviceAreas.length,2);
 p.data.saving=false;p.data.profileDraft.cityCode='';p.useResidentCity(event);assert.match(p.data.editorError,/设置常驻城市/);
});
test('service save returns to its list only after the write is confirmed',async()=>{
 const p=page(editorDefinition);p.data.editorView='service';p.data.activeServiceIndex=0;p.data.serviceDrafts=draft().services;
 let finish;p.persistDraft=()=>new Promise(resolve=>finish=resolve);let refreshed=0;p.refreshDerived=()=>refreshed++;
 const saving=p.saveSection();assert.equal(p.data.sectionSaveComplete,false);finish(true);await saving;
 assert.equal(p.data.sectionSaveComplete,false);assert.equal(p.data.editorView,'manage');assert.equal(p.data.managementTab,'services');assert.equal(refreshed,1);
});


test('local thumbnails appear before network completion and failed files retry without reselecting', async t => {
 const p=editor();let finish;
 p.saveSelectedFile=()=>new Promise(resolve=>finish=resolve);
 const task=p.uploadWorkImages([{tempFilePath:'local-new'}],p.data.selectedWork.id);
 assert.equal(p.data.pendingImagePreviews[0].preview,'local-new');
 assert.equal(p.data.pendingImagePreviews[0].state,'上传中');
 finish({assetId:'new',preview:'local-new',status:'PENDING_SECURITY_REVIEW'});await task;
 assert.ok(p.data.selectedWork.imagePreviews.includes('local-new'));assert.equal(p.data.pendingImagePreviews.length,0);
 p.saveSelectedFile=async()=>{throw Error('offline');};await p.uploadWorkImages([{tempFilePath:'failed'}],p.data.selectedWork.id);
 assert.equal(p.data.pendingImagePreviews[0].state,'上传失败');
 p.saveSelectedFile=async()=>({assetId:'retry',preview:'failed',status:'READY'});await p.retryWorkImages();
 assert.equal(p.data.selectedWork.imageAssetIds.filter(id=>id==='retry').length,1);assert.equal(p.data.pendingImagePreviews.length,0);
});
test('drag reorders source, display and watermark together; cancel preserves order',()=>{
 const p=editor();p.data.workDrafts[0]={...p.data.workDrafts[0],imagePreviews:['a','b'],imageAssetIds:['a','b'],sourceImagePreviews:['sa','sb'],sourceImageAssetIds:['sa','sb'],mediaStatuses:['READY','REJECTED'],watermarks:[null,{text:'B'}]};p.refreshDerived();
 p.data.dragImageIndex=1;p.data.dragTargetIndex=0;p.finishImageDrag();
 assert.deepEqual(p.data.selectedWork.imageAssetIds,['b','a']);assert.deepEqual(p.data.selectedWork.sourceImageAssetIds,['sb','sa']);assert.equal(p.data.selectedWork.watermarks[0].text,'B');
 p.data.dragImageIndex=0;p.data.dragTargetIndex=1;p.cancelImageDrag();p.finishImageDrag();assert.deepEqual(p.data.selectedWork.imageAssetIds,['b','a']);
});
test('review refresh uses verified terminal status and ignores responses after leaving',async t=>{
 const p=editor();p.data.remoteEnabled=true;p.data.workDrafts[0].mediaStatuses=['PENDING_SECURITY_REVIEW'];p.data.workDrafts[0].sourceImageAssetIds=['image1'];p.data.workDrafts[0].sourceMediaStatuses=['PENDING_SECURITY_REVIEW'];p.refreshDerived();
 let count=0;t.mock.method(cloudCatalog,'getImageStatus',async id=>{count++;return {assetId:id,status:'READY'};});
 await p.refreshMediaReview();assert.equal(count,1);assert.equal(p.data.selectedWork.mediaStatuses[0],'READY');assert.equal(p.data.selectedWork.sourceMediaStatuses[0],'READY');
 p.data.workDrafts[0].mediaStatuses=['PENDING_SECURITY_REVIEW'];
 let finish;t.mock.method(cloudCatalog,'getImageStatus',()=>new Promise(resolve=>finish=resolve));const task=p.refreshMediaReview();p.unloaded=true;finish({assetId:'image1',status:'REJECTED'});await task;assert.equal(p.data.workDrafts[0].mediaStatuses[0],'PENDING_SECURITY_REVIEW');
});
