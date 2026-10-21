const test=require('node:test'),assert=require('node:assert/strict');
const activity=require('../miniprogram/data/me-activity');
test('role-specific cooperation totals and todo use existing stages, not mock stages',()=>{
 const orders=['REQUESTED','CONTACTING','IN_PRODUCTION','COMPLETED','DECLINED'].map((stage,i)=>({id:String(i),stage,viewerRole:'PROVIDER'}));
 assert.deepEqual(activity.select(orders,'provider','coops').map(o=>o.stage),['IN_PRODUCTION','COMPLETED']);
 assert.equal(activity.select(orders,'buyer','coops').length,0);
 assert.equal(activity.select(orders,'provider','todo').length,1);
 assert.equal(activity.destination({id:'order',stage:'NDA_PROVIDER_PENDING'},'provider','todo'),'/pages/provider-task/index?id=order');
 assert.equal(activity.destination({id:'order',stage:'DELIVERY_PENDING'},'buyer','todo'),'/pages/fulfillment/index?id=order');
 assert.equal(activity.destination({id:'order',stage:'COMPLETED'},'buyer','reviews'),'/pages/review/index?id=order');
});
function page(file){let definition;global.Page=p=>definition=p;delete require.cache[require.resolve(file)];require(file);delete global.Page;return {...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};}
test('support screenshot previews preserve failed image slots and obey current account',()=>{
 let owner='one',preview;global.getApp=()=>({globalData:{account:{id:owner}}});global.wx={previewImage:value=>preview=value,showToast(){}};
 const p=page('../miniprogram/pages/support/index');p.owner=owner;p.active=true;p.setData({images:[{assetId:'a',preview:'local-a',status:'READY'},{assetId:'b',preview:'local-b',status:'PENDING'}]});
 p.previewDraft({currentTarget:{dataset:{id:'b'}}});assert.equal(preview.current,'local-b');assert.deepEqual(preview.urls,['local-a','local-b']);
 p.imageUnavailable({currentTarget:{dataset:{id:'a'}}});assert.equal(p.data.images.length,2);assert.equal(p.data.images[0].status,'READY');assert.equal(p.data.images[0].preview,'');
 p.setData({mode:'detail',record:{attachments:[{assetId:'a',url:'remote-a'},{assetId:'b',url:'remote-b'}]}});p.imageUnavailable({currentTarget:{dataset:{id:'b'}}});assert.equal(p.data.record.attachments.length,2);assert.equal(p.data.record.attachments[1].url,'');
 preview=null;owner='two';p.previewImage({currentTarget:{dataset:{id:'a'}}});assert.equal(preview,null);
});
test('social details clear after logout and ignore late previous-owner results',async t=>{
 let owner='one',finish,calls=0;global.getApp=()=>({globalData:{account:owner?{id:owner}:null}});
 const service=require('../miniprogram/services/cloud-saved-items');t.mock.method(service,'listReceived',()=>{calls++;return new Promise(r=>finish=r);});
 const p=page('../miniprogram/pages/me-social/index');p.owner=owner;p.active=true;p.setData({items:[{id:'private'}],cursor:{time:1,id:'x'},ready:true});
 const read=p.load({currentTarget:{dataset:{more:'1'}}});await p.load();assert.equal(calls,1);p.onHide();owner=null;p.onShow();assert.deepEqual(p.data.items,[]);assert.equal(p.data.cursor,null);
 finish({items:[{id:'late'}],cursor:null});await read;assert.deepEqual(p.data.items,[]);await p.load();assert.equal(calls,1);
 owner='two';p.onShow();assert.equal(calls,2);finish({items:[],cursor:null});
});
test('permission callbacks cannot overwrite a newer read after returning to settings',()=>{
 const callbacks=[];global.getApp=()=>({globalData:{account:{id:'one'}}});global.wx={getSetting:o=>callbacks.push(o)};
 const p=page('../miniprogram/pages/settings/index');p.owner='one';p.active=true;p.generation=1;p.readPermission();p.onHide();p.active=true;p.generation++;p.readPermission();
 callbacks[1].success({authSetting:{'scope.userFuzzyLocation':true}});callbacks[0].success({authSetting:{'scope.userFuzzyLocation':false}});assert.equal(p.data.location,'已允许');callbacks[0].fail();assert.equal(p.data.location,'已允许');
});
test('support supplement retry survives page recreation and resolves from recorded history',async t=>{
 const storage={},calls=[],record={id:'sup_one',kind:'FEEDBACK',status:'PENDING',version:1,createdAt:100,events:[]};
 let owner='one';global.getApp=()=>({globalData:{account:{id:owner}}});global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=structuredClone(v),removeStorageSync:k=>delete storage[k]};
 const service=require('../miniprogram/services/cloud-support');t.mock.method(service,'call',async data=>{calls.push(data);if(data.action==='get')return structuredClone(record);throw Error('lost');});
 const p=page('../miniprogram/pages/support/index');p.onLoad({id:record.id});p.active=true;p.setData({record,supplement:'补充原始内容'});await p.mutate('append','补充原始内容');assert.equal(p.data.mutationUnknown,true);
 const q=page('../miniprogram/pages/support/index');q.onLoad({id:record.id});q.active=true;await q.load();assert.equal(q.data.supplement,'补充原始内容');q.input({currentTarget:{dataset:{field:'supplement'}},detail:{value:'变更'}});assert.equal(q.data.supplement,'补充原始内容');await q.retryMutation();assert.equal(calls[0].idempotencyKey,calls[2].idempotencyKey);
 record.events=[{id:calls[0].idempotencyKey,actor:'USER',text:'补充原始内容',time:200}];record.version=2;await q.load();assert.equal(q.data.mutationUnknown,false);assert.equal(q.data.supplement,'');assert.equal(Object.keys(storage).length,0);
 owner='two';const r=page('../miniprogram/pages/support/index');r.onLoad({id:record.id});assert.equal(r.mutation,undefined);
});
test('support withdrawal confirmation is bound to its original page and version',()=>{
 let modal,calls=0;global.getApp=()=>({globalData:{account:{id:'one'}}});global.wx={showModal:o=>modal=o};
 const p=page('../miniprogram/pages/support/index');p.owner='one';p.active=true;p.generation=1;p.setData({record:{version:1}});p.mutate=()=>calls++;
 p.append({currentTarget:{dataset:{action:'withdraw'}}});p.data.record.version=2;modal.success({confirm:true});assert.equal(calls,0);
 p.append({currentTarget:{dataset:{action:'withdraw'}}});p.onHide();p.active=true;modal.success({confirm:true});assert.equal(calls,0);
});
test('support does not send a mutation when its retry record cannot be saved',async t=>{
 let calls=0;global.wx={setStorageSync(){throw Error('full');}};global.getApp=()=>({globalData:{account:{id:'one'}}});
 const service=require('../miniprogram/services/cloud-support');t.mock.method(service,'call',async()=>calls++);
 const p=page('../miniprogram/pages/support/index');p.owner='one';p.recordId='sup_one';p.active=true;p.setData({record:{version:1}});await p.mutate('append','补充说明');assert.equal(calls,0);assert.equal(p.mutation,null);assert.equal(p.data.pending,false);
});
test('support late reads cannot overwrite a newer successful supplement',async t=>{
 let finish;global.wx={setStorageSync(){},removeStorageSync(){}};global.getApp=()=>({globalData:{account:{id:'one'}}});
 const record={id:'sup_one',kind:'FEEDBACK',status:'PROCESSING',version:2,createdAt:100,events:[]};const service=require('../miniprogram/services/cloud-support');
 t.mock.method(service,'call',async data=>data.action==='get'?new Promise(r=>finish=r):structuredClone(record));
 const p=page('../miniprogram/pages/support/index');p.owner='one';p.recordId='sup_one';p.active=true;p.setData({mode:'detail',record:{...record,version:1}});const reading=p.load();await p.mutate('append','新的说明');finish({...record,version:1});await reading;assert.equal(p.data.record.version,2);assert.equal(p.data.loading,false);
});
test('support image review survives returning from background but never crosses accounts',async t=>{
 let owner='one',finish;global.wx={getStorageSync(){}};global.getApp=()=>({globalData:{account:{id:owner}}});
 const catalog=require('../miniprogram/services/cloud-catalog');t.mock.method(catalog,'getImageStatus',()=>new Promise(r=>finish=r));
 const p=page('../miniprogram/pages/support/index');p.onLoad({});p.onShow();p.setData({images:[{assetId:'asset',status:'PENDING'}]});
 const first=p.refreshImages();p.onHide();p.onShow();finish({status:'READY'});await first;assert.equal(p.data.uploading,false);assert.equal(p.data.images[0].status,'READY');
 const second=p.refreshImages();p.onHide();owner='two';p.onShow();finish({status:'READY'});await second;assert.deepEqual(p.data.images,[]);assert.equal(p.pendingImages,null);
});
test('support image URLs match the requested file and failures retain an unavailable slot',async()=>{
 const service=require('../miniprogram/services/cloud-support'),record={attachments:[{assetId:'a',fileId:'cloud://a'}]};
 global.wx={cloud:{getTempFileURL:async()=>({fileList:[{fileID:'cloud://other',tempFileURL:'https://other',status:0}]})}};
 assert.equal((await service.withImages(record)).attachments[0].url,'');
 global.wx.cloud.getTempFileURL=async()=>{throw Error('offline');};assert.equal((await service.withImages(record)).attachments[0].assetId,'a');
});
test('new aggregation ignores a response after account change and refreshes on return',async t=>{
 let owner='one',finish;global.wx={getStorageSync:()=> 'buyer'};global.getApp=()=>({globalData:{account:{id:owner}}});
 const service=require('../miniprogram/services/cloud-orders');t.mock.method(service,'listOrders',()=>new Promise(r=>finish=r));
 const p=page('../miniprogram/pages/me-activity/index');p.mode='coops';const pending=p.refresh();owner='two';finish([{id:'x',viewerRole:'BUYER',stage:'COMPLETED'}]);await pending;assert.deepEqual(p.data.items,[]);
 owner='one';t.mock.method(service,'listOrders',async()=>[{id:'x',viewerRole:'BUYER',stage:'COMPLETED'}]);await p.refresh();assert.equal(p.data.items.length,1);
});
test('feedback retry restores the same key after an uncertain result and never fakes success',async t=>{
 const storage={},calls=[];global.wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=structuredClone(v),removeStorageSync:k=>delete storage[k]};global.getApp=()=>({globalData:{account:{id:'one'}}});
 const service=require('../miniprogram/services/cloud-support');t.mock.method(service,'call',async data=>{calls.push(data);throw Error('lost response');});
 const p=page('../miniprogram/pages/support/index');p.onLoad({});p.onShow();p.setData({description:'首次打开地址显示很慢，希望能核对原因。'});await p.submit();assert.equal(p.data.mode,'form');assert.equal(p.data.unknown,true);
 const q=page('../miniprogram/pages/support/index');q.onLoad({});q.onShow();assert.equal(q.data.description,p.data.description);await q.submit();assert.equal(calls[0].idempotencyKey,calls[1].idempotencyKey);
 global.getApp=()=>({globalData:{account:{id:'two'}}});const r=page('../miniprogram/pages/support/index');r.onLoad({});assert.equal(r.data.description,'');
});
test('settings logout only clears session after confirmation',()=>{
 let modal,cleared=0,redirect='';global.getApp=()=>({globalData:{account:{id:'one'}},clearServerSession(){cleared++;}});global.wx={showModal:o=>modal=o,setStorageSync(){},reLaunch:o=>redirect=o.url};
 const p=page('../miniprogram/pages/settings/index');p.active=true;p.owner='one';p.logout();modal.success({confirm:false});assert.equal(cleared,0);p.logout();modal.success({confirm:true});assert.equal(cleared,1);assert.equal(redirect,'/pages/auth/index?signedOut=1');
});

test('account settings ignore an old identity response after leaving and returning', async t=>{
  let id='one',finish;global.getApp=()=>({globalData:{account:{id}}});global.wx={getStorageSync(){return 'buyer';}};
  const account=require('../miniprogram/services/cloud-account');t.mock.method(account,'getMine',()=>new Promise(r=>finish=r));
  const p=page('../miniprogram/pages/settings/index');p.active=true;p.owner=id;p.generation=1;const pending=p.loadAccount();p.onHide();id='two';p.owner=id;p.active=true;p.generation++;finish({nickname:'old',username:'Old'});await pending;assert.equal(p.data.nickname,'');
});

test('all new interiors bind the opening workspace to the shared back control',()=>{
 const fs=require('node:fs'),path=require('node:path');
 global.getApp=()=>({globalData:{account:{id:'one'}}});
 for(const role of ['buyer','provider']){
  global.wx={getStorageSync:key=>key==='animeMasterRole'?role:undefined};
  for(const name of ['help','settings','support','me-social','me-activity']){
   const p=page('../miniprogram/pages/'+name+'/index');p.onLoad({});
   if(name==='me-activity'){p.refresh=()=>{};p.onShow();}
   assert.equal(p.data.navWorkspace,role,name);
   assert.match(fs.readFileSync(path.join(__dirname,'../miniprogram/pages',name,'index.wxml'),'utf8'),/<app-top-nav[^>]*workspace="{{navWorkspace}}"/);
  }
 }
});

test('new feedback preserves input and sends nothing when retry storage is unavailable',async t=>{
 let calls=0;global.getApp=()=>({globalData:{account:{id:'one'}}});global.wx={getStorageSync:()=>undefined,setStorageSync(){throw Error('storage full');}};
 t.mock.method(require('../miniprogram/services/cloud-support'),'call',async()=>{calls++;});
 const p=page('../miniprogram/pages/support/index');p.onLoad({});p.active=true;p.setData({description:'首次打开后位置一直未能显示，请帮助核查。',orderId:'order_one'});
 await p.submit();assert.equal(calls,0);assert.equal(p.data.pending,false);assert.equal(p.data.unknown,false);assert.equal(p.data.orderId,'order_one');assert.ok(p.data.description.length>10);assert.match(p.data.error,/未发送/);
});
