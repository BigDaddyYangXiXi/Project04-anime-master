const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const calendar=require('../miniprogram/data/calendar-model');
function fixture(api={}) {
 const app={globalData:{account:{id:'owner'}}},calls=[];let definition;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/pages/provider-detail/index.js'),'utf8'),{
  Page:p=>definition=p, getApp:()=>app, Date,
  wx:{navigateBack:()=>calls.push('back'),pageScrollTo:()=>{}},
  require:name=>name.endsWith('calendar-model')?calendar:name.endsWith('cloud-availability')?api:{},
 });
 const p={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch){Object.assign(this.data,patch);}};
 p.data.provider={id:'owner',services:[]};p.providerPreview=true;
 return {p,app,calls};
}
test('本人未发布橱窗档期按需读取真实记录，切月不重复请求',async()=>{
 let reads=0;const {p}=fixture({getMine:async()=>{reads++;return {openDates:['2026-10-25'],lockedDates:['2026-10-26']};}});
 await p.loadStorefrontCalendar();assert.equal(p.data.calendarKnown,true);assert.equal(p.data.calendarDays.length,42);
 p.changeStorefrontMonth({currentTarget:{dataset:{step:1}}});assert.equal(reads,1);assert.equal(p.data.calendarOffset,1);
});
test('访客读取公开档期，不读取服务方私有接口',async()=>{
 let id;const {p}=fixture({getMine:()=>{throw Error('不应读取私有档期');},getPublic:async value=>{id=value;return {openDates:[],lockedDates:[]};}});
 p.providerPreview=false;p.data.provider.id='other';await p.loadStorefrontCalendar();assert.equal(id,'other');assert.equal(p.data.calendarKnown,true);
});
test('切换账号后迟到档期不写入新账号画面',async()=>{
 let finish;const {p,app}=fixture({getMine:()=>new Promise(resolve=>finish=resolve)});
 const pending=p.loadStorefrontCalendar();app.globalData.account.id='new-owner';finish({openDates:[],lockedDates:[]});await pending;
 assert.equal(p.data.calendarKnown,false);assert.equal(p.data.calendarDays.length,0);
});
test('档期失败显示重试，不生成虚假空档期',async()=>{
 const {p}=fixture({getMine:async()=>{throw Error('offline');}});await p.loadStorefrontCalendar();
 assert.equal(p.data.calendarKnown,false);assert.equal(p.data.calendarLoading,false);assert.match(p.data.calendarError,/重试/);assert.equal(p.data.calendarDays.length,0);
});
test('服务详情和阅读页返回上一级，不直接跳回发布确认',()=>{
 const {p,calls}=fixture();p.data.serviceDetail={id:'s'};p.continueEditing();assert.equal(p.data.serviceDetail,null);assert.equal(calls.length,0);
 p.togglePreferences();assert.equal(p.data.readingPage,'preferences');p.backStorefrontPage();assert.equal(p.data.readingPage,'');assert.equal(calls.length,0);
 p.continueEditing();assert.deepEqual(calls,['back']);
});
