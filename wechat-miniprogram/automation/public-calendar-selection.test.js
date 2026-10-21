const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../miniprogram/data/calendar-model');
const catalog=require('../miniprogram/services/cloud-catalog');
const availability=require('../miniprogram/services/cloud-availability');
let definition;global.Page=value=>{definition=value;};require('../miniprogram/pages/provider-schedule/index');delete global.Page;
function page(){return {...definition,cloudMode:true,calendarMonth:calendar.monthFrom('2099-01-01'),openDates:[],lockedDates:[],data:{...structuredClone(definition.data),provider:{id:'p'},selectedDate:'2099-01-01',selectedDay:1},setData(patch,callback){Object.assign(this.data,patch);if(callback)callback();}};}
test('未发布服务方的本人档期预览使用本人接口，不依赖公开目录',async t=>{
 const previous=global.getApp;global.getApp=()=>({globalData:{account:{id:'p'}}});t.after(()=>{global.getApp=previous;});
 const p=page();p.providerPreview=true;
 t.mock.method(catalog,'getProvider',async()=>{throw Error('不应读取公开目录');});
 t.mock.method(availability,'getPublic',async()=>{throw Error('不应读取公开档期');});
 t.mock.method(catalog,'getDraft',async()=>({providerId:'p',clientDraft:{career:'妆娘',profile:{nickname:'本人'}}}));
 t.mock.method(availability,'getMine',async()=>({openDates:['2099-01-01'],lockedDates:[]}));
 await p.loadCloud({id:'p',date:'2099-01-01'});assert.equal(p.data.provider.name,'本人');assert.equal(p.data.loadError,'');
});
test('档期失败按原入口重试恢复，旧请求与离页结果不回写',async t=>{
 const p=page();let fail=true;
 t.mock.method(catalog,'getProvider',async()=>{if(fail)throw Error('offline');return {provider:{id:'p',nickname:'服务方'}};});
 t.mock.method(availability,'getPublic',async()=>({openDates:[],lockedDates:[]}));
 await p.loadCloud({id:'p',date:'2099-01-01'});assert.ok(p.data.loadError);
 fail=false;await p.retryLoad();assert.equal(p.data.provider.id,'p');assert.equal(p.data.selectedDate,'2099-01-01');
 for(const leave of ['newer','unload'])for(const failed of [false,true]){
  const p=page();let resolve,reject,calls=0,writes=0;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  t.mock.method(catalog,'getProvider',()=>++calls===1?pending:Promise.resolve({provider:{id:'new',nickname:'新服务方'}}));
  const read=p.loadCloud({id:'p'});
  if(leave==='newer')await p.loadCloud({id:'new'});else {p.onUnload();p.setData=()=>{writes++;};}
  if(failed)reject(Error('old'));else resolve({provider:{id:'old',nickname:'旧服务方'}});await read;
  if(leave==='newer')assert.equal(p.data.provider.id,'new');else assert.equal(writes,0);
 }
});
test('公开档期过期或满客不可进入预约，未公开有效日仍可预约',t=>{
 let today='2099-01-01',calls=0;global.wx={navigateTo(){calls++;},showToast(){}};
 t.mock.method(calendar,'todayKey',()=>today);
 const p=page();p.refresh();p.startBooking();assert.equal(calls,1);
 today='2099-01-02';p.startBooking();assert.equal(calls,1);assert.equal(p.data.canBook,false);today='2099-01-01';
 p.lockedDates=['2099-01-01'];p.refresh();p.startBooking();assert.equal(calls,1);
 p.lockedDates=[];p.data.selectedDate='2000-01-01';p.data.selectedDay=1;p.calendarMonth=calendar.monthFrom('2000-01-01');p.refresh();p.startBooking();assert.equal(calls,1);
});
test('无效或过去的入口日期回到当天，选择不存在的日不改变当前选择',async t=>{
 t.mock.method(calendar,'todayKey',()=> '2099-01-01');
 t.mock.method(catalog,'getProvider',async()=>({provider:{id:'p',nickname:'服务方'}}));
 t.mock.method(availability,'getPublic',async()=>({openDates:[],lockedDates:[]}));
 for(const date of ['2099-02-31','2099-13-01','2000-01-01']){
  const p=page();await p.loadCloud({id:'p',date});assert.equal(p.data.selectedDate,'2099-01-01');
  p.chooseDate({currentTarget:{dataset:{date:'2099-01-99',day:99}}});assert.equal(p.data.selectedDate,'2099-01-01');
 }
});
