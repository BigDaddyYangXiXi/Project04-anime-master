const test=require('node:test');
const assert=require('node:assert/strict');
const availability=require('../miniprogram/services/cloud-availability');
const projects=require('../miniprogram/services/cloud-projects');
const orders=require('../miniprogram/services/cloud-orders');
let definition;global.Page=value=>{definition=value;};require('../miniprogram/pages/projects/index');delete global.Page;
function page(){return {...definition,availabilityCloudMode:true,data:structuredClone(definition.data),setData(patch,callback){Object.assign(this.data,patch);if(callback)callback();}};}
test('根页换账号显示前清除旧项目档期草稿与创建键，同账号返回保留',()=>{
 const p=page();p.cloudMode=true;p.viewOwner='a';let owner='a',reads=0;
 global.getApp=()=>({globalData:{account:{id:owner}}});global.wx={getStorageSync(){return 'provider';}};
 p.loadCalendar=()=>{reads++;};p.data.projects=[{id:'private'}];p.data.draftDates=['2099-01-01'];p.data.lockedDates=['2099-01-02'];p.data.changed=true;p.createIdempotencyKey='old-key';p.data.message='旧提示';
 p.onShow();assert.deepEqual(p.data.draftDates,['2099-01-01']);assert.equal(p.createIdempotencyKey,'old-key');
 owner='b';p.onShow();assert.deepEqual(p.data.projects,[]);assert.deepEqual(p.data.draftDates,[]);assert.deepEqual(p.data.lockedDates,[]);assert.equal(p.data.changed,false);assert.equal(p.data.message,'');assert.equal(p.createIdempotencyKey,'');assert.equal(reads,2);
});
test('项目读取失败可重试恢复，切账号禁止打开旧项目',async t=>{
 const p=page();p.cloudMode=true;let owner='a',fail=true,navigations=0;
 global.getApp=()=>({globalData:{account:{id:owner}}});global.wx={navigateTo(){navigations++;}};
 t.mock.method(projects,'listProjects',async()=>{if(fail)throw Error('offline');return [{id:'p',bookingIds:[]}];});
 t.mock.method(orders,'listOrders',async()=>[]);
 await p.loadProjects();assert.ok(p.data.loadError);fail=false;await p.loadProjects();assert.equal(p.data.loadError,'');assert.equal(p.data.projects.length,1);
 p.openProject({currentTarget:{dataset:{id:'p'}}});assert.equal(navigations,1);
 owner='b';p.openProject({currentTarget:{dataset:{id:'p'}}});assert.equal(navigations,1);assert.deepEqual(p.data.projects,[]);
});
test('项目根列表丢弃旧刷新以及隐藏或换账号后的结果',async t=>{
 for(const leave of ['older','hide','account'])for(const failed of [false,true]){
  const p=page();p.cloudMode=true;let owner='a',resolve,reject,calls=0,writes=0;
  global.getApp=()=>({globalData:{account:{id:owner}}});
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  t.mock.method(projects,'listProjects',()=>++calls===1?pending:Promise.resolve([{id:'new',bookingIds:[]}]));
  t.mock.method(orders,'listOrders',async()=>[]);
  const read=p.loadProjects();
  if(leave==='older')await p.loadProjects();else {if(leave==='hide')p.onHide();else owner='b';p.setData=()=>{writes++;};}
  if(failed)reject(Error('old'));else resolve([]);await read;
  if(leave==='older')assert.equal(p.data.projects[0].id,'new');else assert.equal(writes,0);
 }
});
test('正常创建仍打开Brief，隐藏后返回解除旧请求锁且保留重试键',async t=>{
 const p=page();p.cloudMode=true;p.viewOwner='a';p.createIdempotencyKey='stable-key';global.getApp=()=>({globalData:{account:{id:'a'}}});
 let target,loads=0;global.wx={navigateTo(value){target=value.url;},getStorageSync(){return 'buyer';}};
 t.mock.method(projects,'createProject',async key=>{assert.equal(key,'stable-key');return {id:'new-project'};});
 await p.createProject();assert.equal(target,'/pages/brief/index?id=new-project&new=1');assert.equal(p.data.actionPending,false);
 p.data.actionPending=true;p.createIdempotencyKey='retry-key';p.onHide();p.loadProjects=()=>{loads++;};p.onShow();
 assert.equal(p.data.actionPending,false);assert.equal(p.createIdempotencyKey,'retry-key');assert.equal(loads,1);
});
test('档期保存和项目创建在隐藏、卸载或切账号后不回写跳转',async t=>{
 for(const action of ['save','createProject'])for(const leave of ['hide','unload','account'])for(const failed of [false,true]){
  const p=page();p.cloudMode=true;p.data.changed=true;p.createIdempotencyKey='test-key';
  let owner='a',resolve,reject,writes=0,navigations=0;
  global.getApp=()=>({globalData:{account:{id:owner}}});global.wx={navigateTo(){navigations++;}};
  t.mock.method(action==='save'?availability:projects,action==='save'?'saveMine':'createProject',()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
  const request=p[action]();
  if(leave==='hide')p.onHide();else if(leave==='unload')p.onUnload();else owner='b';
  p.setData=()=>{writes++;};
  if(failed)reject(Error('late'));else resolve({id:'new-project',version:2,openDates:[],lockedDates:[]});
  await request;assert.equal(writes,0);assert.equal(navigations,0);
 }
});
test('同账号同版本档期返回保留未保存日期，版本或账号变化重新核对',async t=>{
 let owner='a',version=1,lockedDates=[];global.getApp=()=>({globalData:{account:{id:owner}}});
 t.mock.method(availability,'getMine',async()=>({version,openDates:[],lockedDates}));
 const p=page();await p.loadCalendar();p.data.draftDates=['2099-01-01'];
 await p.loadCalendar();assert.deepEqual(p.data.draftDates,['2099-01-01']);
 version=2;await p.loadCalendar();assert.deepEqual(p.data.draftDates,[]);
 p.data.draftDates=['2099-01-01'];owner='b';await p.loadCalendar();assert.deepEqual(p.data.draftDates,[]);
 p.data.draftDates=['2099-01-01'];lockedDates=['2099-01-01'];await p.loadCalendar();assert.deepEqual(p.data.draftDates,[]);assert.deepEqual(p.data.lockedDates,lockedDates);
});
test('正在保存档期时不发起覆盖草稿的刷新',async t=>{
 const p=page();p.data.actionPending=true;
 let calls=0;t.mock.method(availability,'getMine',async()=>{calls++;return {version:1,openDates:[],lockedDates:[]};});
 await p.loadCalendar();assert.equal(calls,0);
});
test('保存前发出的旧读取不能覆盖保存后的新档期',async t=>{
 global.getApp=()=>({globalData:{account:{id:'a'}}});const p=page();
 t.mock.method(availability,'getMine',async()=>({version:1,openDates:[],lockedDates:[]}));await p.loadCalendar();
 let resolve;t.mock.method(availability,'getMine',()=>new Promise(yes=>{resolve=yes;}));const read=p.loadCalendar();
 p.data.draftDates=['2099-01-01'];p.data.changed=true;
 t.mock.method(availability,'saveMine',async()=>({version:2,openDates:['2099-01-01'],lockedDates:[]}));
 await p.save();resolve({version:1,openDates:[],lockedDates:[]});await read;
 assert.equal(p.data.availabilityVersion,2);assert.deepEqual(p.data.draftDates,['2099-01-01']);assert.equal(p.data.calendarLoading,false);
});
