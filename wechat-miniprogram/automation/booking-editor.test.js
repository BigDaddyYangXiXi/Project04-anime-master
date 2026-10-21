const test=require('node:test'),assert=require('node:assert/strict');let definition;global.Page=d=>definition=d;global.wx={showToast(){},navigateTo(){},getStorageSync(){return ''}};require('../miniprogram/pages/booking/index');delete global.Page;const cloudOrders=require('../miniprogram/services/cloud-orders');
function page(){const p={data:structuredClone(definition.data),cloudMode:true};for(const [k,v]of Object.entries(definition))if(typeof v==='function')p[k]=v.bind(p);p.setData=(patch,cb)=>{for(const [key,value]of Object.entries(patch)){const parts=key.split('.');let o=p.data;while(parts.length>1){const k=parts.shift();o=o[k]}o[parts[0]]=value}if(cb)cb()};const svc={id:'follow',name:'现场跟妆',price:360,priceText:'￥360',unit:'4小时',selected:true,availableInCity:true};Object.assign(p.data,{provider:{id:'p1',services:[svc,{id:'makeup',name:'角色妆造',price:520,priceText:'￥520',selected:false,availableInCity:true}]},selectedServices:[svc],displayedTotal:360,selectedServiceText:'现场跟妆',city:'杭州',cityCode:'330100',minDate:'2099-01-01',date:'2099-01-02',startDate:'2099-01-02',endDate:'2099-01-02',startTime:'10:00',endTime:'14:00',contact:{name:'测试',wechat:'demo',phone:''},note:'这是一段长度合格的测试预约需求',work:{id:'w1'}});p.validate();return p}
const evt=section=>({currentTarget:{dataset:{section}}});
for(const outcome of ['success','failure'])test(`预约资料旧${outcome}不能覆盖较新的读取`,async(t)=>{
  const p=page();let resolve,reject;
  t.mock.method(require('../miniprogram/services/cloud-account'),'getDiscoveryPreference',async()=>({}));
  t.mock.method(require('../miniprogram/services/cloud-catalog'),'getProvider',id=>id==='old'?new Promise((yes,no)=>{resolve=yes;reject=no}):Promise.resolve({provider:{id,nickname:id,services:[],works:[]}}));
  p.initializeBooking=(_options,_repeat,provider)=>p.setData({provider});
  const first=p.loadCloudBooking({providerId:'old'});await new Promise(done=>setImmediate(done));
  await p.loadCloudBooking({providerId:'new'});const before=JSON.stringify(p.data);
  if(outcome==='success')resolve({provider:{id:'old',nickname:'old',services:[],works:[]}});else reject(Error('late'));
  await first;assert.equal(JSON.stringify(p.data),before);
});
test('离页后迟到的地区读取不得继续读取预约服务方',async(t)=>{
  const p=page();let resolve;
  t.mock.method(require('../miniprogram/services/cloud-account'),'getDiscoveryPreference',()=>new Promise(yes=>resolve=yes));
  t.mock.method(require('../miniprogram/services/cloud-catalog'),'getProvider',async()=>assert.fail('不能发起迟到的服务方请求'));
  const pending=p.loadCloudBooking({providerId:'old'});p.onUnload();p.setData=()=>assert.fail('不能更新旧页');resolve({});await pending;
});
test('退出预约页后参考审核结果不能继续创建订单',async(t)=>{
  const p=page();let finish; p.ensureReferenceAsset=()=>new Promise(resolve=>finish=resolve);
  t.mock.method(cloudOrders,'createOrder',async()=>assert.fail('离页后不能发起订单'));
  const pending=p.submitBooking();p.onUnload();finish('asset');await pending;
});
for(const outcome of ['success','failure'])test(`退出预约页忽略已发请求的迟到${outcome}`,async(t)=>{
  const p=page();p.ensureReferenceAsset=async()=>null;let resolve,reject;
  t.mock.method(cloudOrders,'createOrder',()=>new Promise((yes,no)=>{resolve=yes;reject=no}));
  const pending=p.submitBooking();await new Promise(done=>setImmediate(done));p.onUnload();
  p.setData=()=>assert.fail('不能更新已退出页面');
  t.mock.method(global.wx,'navigateTo',()=>assert.fail('不能从旧页面跳转'));
  if(outcome==='success')resolve({id:'saved-order'});else reject(Error('late'));await pending;
});
test('参考图授权后选择仍遵守抽屉取消边界',()=>{const p=page();let picker;global.wx.chooseMedia=options=>{picker=options};p.openEditor(evt('reference'));p.chooseReferenceFile();p.cancelEditor();picker.success({tempFiles:[{tempFilePath:'/tmp/late.jpg'}]});assert.equal(p.data.referenceFile,null);p.openEditor(evt('reference'));p.chooseReferenceFile();picker.success({tempFiles:[]});assert.equal(p.data.referenceFile,null);picker.success({tempFiles:[{tempFilePath:'/tmp/current.jpg'}]});assert.equal(p.data.referenceFile.name,'current.jpg');delete global.wx.chooseMedia});
test('取消服务与联系编辑恢复原值和金额',()=>{const p=page();p.openEditor(evt('services'));p.toggleService({currentTarget:{dataset:{id:'makeup'}}});assert.equal(p.data.displayedTotal,880);p.cancelEditor();assert.equal(p.data.displayedTotal,360);assert.equal(p.data.selectedServices.length,1);p.openEditor(evt('contact'));p.updateContact({currentTarget:{dataset:{key:'name'}},detail:{value:'新名字'}});p.cancelEditor();assert.equal(p.data.contact.name,'测试')});
test('服务保存更新合计，空服务保存停在抽屉',()=>{const p=page();p.openEditor(evt('services'));p.toggleService({currentTarget:{dataset:{id:'makeup'}}});p.saveEditor();assert.equal(p.data.editorSection,'');assert.equal(p.data.displayedTotal,880);p.openEditor(evt('services'));for(const id of ['follow','makeup'])p.toggleService({currentTarget:{dataset:{id}}});p.saveEditor();assert.equal(p.data.editorSection,'services');assert(p.data.editorError)});
test('无效时段不能保存，取消恢复有效时间',()=>{const p=page();p.openEditor(evt('time'));p.updateEndTime({detail:{value:'09:00'}});p.saveEditor();assert.equal(p.data.editorSection,'time');assert(p.data.editorError);p.cancelEditor();assert.equal(p.data.endTime,'14:00');assert.equal(p.data.timeValid,true)});
test('缺少联系人时发送进入对应抽屉',async()=>{const p=page();p.data.contact.name='';p.validate();await p.submitBooking();assert.equal(p.data.editorSection,'contact')});
test('保存后仍提交原接口需要的服务与联系人，不在客户端改价',async(t)=>{const p=page();p.requestIdempotencyKey='test-key';p.ensureReferenceAsset=async()=>null;let payload;t.mock.method(cloudOrders,'createOrder',async value=>{payload=value;return{id:'order-test'}});p.openEditor(evt('note'));p.updateNote({detail:{value:'更新后的角色妆容与拍摄现场要求'}});p.saveEditor();await p.submitBooking();assert.deepEqual(payload.serviceIds,['follow']);assert.equal(payload.contact.name,'测试');assert.equal(payload.requirement,'更新后的角色妆容与拍摄现场要求');assert.equal(payload.price,undefined);assert.equal(payload.timeSegments.length,1)});

test('保密选择传入预约且发送期间不能更改',async(t)=>{const p=page();p.requestIdempotencyKey='nda-test-key';p.ensureReferenceAsset=async()=>null;let input;t.mock.method(cloudOrders,'createOrder',async value=>{input=value;return{id:'nda-order'}});p.changeNda({detail:{value:true}});await p.submitBooking();assert.equal(input.ndaRequired,true);p.changeNda({detail:{value:false}});assert.equal(p.data.ndaRequired,true)});

test('预约发送失败保留输入，重试沿用同一请求标识并拦截连点',async t=>{
 const p=page();p.requestIdempotencyKey='stable-key';p.ensureReferenceAsset=async()=>null;const inputs=[];let resolve;
 t.mock.method(cloudOrders,'createOrder',async input=>{inputs.push(structuredClone(input));if(inputs.length===1)throw Error('unknown network result');return new Promise(done=>{resolve=done;});});
 const note=p.data.note,contact=structuredClone(p.data.contact);await p.submitBooking();assert.equal(p.data.note,note);assert.deepEqual(p.data.contact,contact);assert.equal(p.data.submitting,false);assert(p.data.message);
 const retry=p.submitBooking();await new Promise(done=>setImmediate(done));await p.submitBooking();assert.equal(inputs.length,2);assert.deepEqual(inputs[1],inputs[0]);assert.equal(inputs[1].idempotencyKey,'stable-key');resolve({id:'same-order'});await retry;assert.equal(p.submittedOrderId,'same-order');
});
test('预约创建成功但跳转失败时只重试跳转，不再创建订单',async t=>{
 const p=page();p.ensureReferenceAsset=async()=>null;let created=0,navigations=0;
 t.mock.method(cloudOrders,'createOrder',async()=>{created++;return{id:'created'};});t.mock.method(global.wx,'navigateTo',options=>{navigations++;if(navigations===1)options.fail();});
 await p.submitBooking();assert.equal(p.data.submitting,false);assert.match(p.data.message,/不会重复创建/);await p.submitBooking();assert.equal(created,1);assert.equal(navigations,2);
});

test('预约资料读取失败不提示发送失败，仍保留具体业务原因',async t=>{
 const p=page();t.mock.method(require('../miniprogram/services/cloud-account'),'getDiscoveryPreference',async()=>{throw Error('offline');});await p.loadCloudBooking({providerId:'p1'});assert.equal(p.data.message,'预约资料读取失败，请重试。');assert.equal(p.data.loadingProvider,false);assert.equal(p.orderErrorMessage(Error('offline')),'预约发送失败，请稍后重试。');assert.match(p.orderErrorMessage({code:'PROVIDER_NOT_PUBLISHED'},'读取失败'),/公开橱窗已下线/);
});
