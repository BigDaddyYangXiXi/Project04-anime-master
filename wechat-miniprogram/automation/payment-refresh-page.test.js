const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../miniprogram/services/cloud-orders');
const gateway = require('../miniprogram/data/payment-gateway');
function connectedService() {
  const sandbox={module:{exports:{}},wx:global.wx,require(name){
    if(name==='../config/cloudbase')return {enabled:true,env:'test-environment'};
    if(name==='../utils/local-preview')return {assertCloudAllowed(){}};
    if(name==='../utils/cloud-call')return require('../miniprogram/utils/cloud-call');
    throw new Error('unexpected dependency');
  }};
  require('node:vm').runInNewContext(require('node:fs').readFileSync(require.resolve('../miniprogram/services/cloud-orders'),'utf8'),sandbox);
  return sandbox.module.exports;
}
let definition; global.Page=value=>{definition=value;};
global.wx={showModal(){},stopPullDownRefresh(){}};
require('../miniprogram/pages/booking-status/index');delete global.Page;
function order(patch={}) { return { id:'order_1',cloudOrder:true,version:1,viewerRole:'BUYER',stage:'BUYER_FINAL_CONFIRM',
  paymentStatus:'UNPAID',buyerAgreementConfirmedAt:1000,communicationDone:true,timePlaceConfirmed:true,
  serviceScopeConfirmed:true,amountConfirmed:true,executable:true,ndaRequired:false,...patch }; }
function page() { const p={...definition,cloudMode:true,orderId:'order_1',data:structuredClone(definition.data)};
  p.setData=patch=>Object.assign(p.data,patch);p.renderOrder(order());return p; }
test('manual queries share an in-flight request and disable another cashier entry',async t=>{
  let done;const waiting=new Promise(resolve=>{done=resolve;});
  const query=t.mock.method(service,'refreshPayment',()=>waiting);
  t.mock.method(service,'getOrder',async()=>order({version:2,paymentStatus:'PAID'}));
  const pay=t.mock.method(gateway,'requestOrderPayment',async()=>{});
  const p=page();const first=p.refreshCloudPayment(),second=p.refreshCloudPayment();
  assert.equal(first,second);assert.equal(p.data.paymentQuerying,true);
  await p.startPayment();assert.equal(pay.mock.callCount(),0);
  done({queryStatus:'QUERIED'});await first;
  assert.equal(query.mock.callCount(),1);assert.equal(p.data.paymentStatus,'PAID');assert.equal(p.data.paymentQuerying,false);
});
test('query failures and cooldown still reread saved facts, preserving a received payment',async t=>{
  let activeKind, activeStatus;
  t.mock.method(service,'refreshPayment',async()=>{if(activeKind==='failure')throw new Error('offline');return {queryStatus:'THROTTLED'};});
  t.mock.method(service,'getOrder',async()=>order({version:2,paymentStatus:activeStatus}));
  for(const kind of ['failure','cooldown']) for(const status of ['UNPAID','PAID','PAYMENT_REVIEW']) {
    activeKind=kind; activeStatus=status;
    const p=page();await p.refreshCloudPayment();assert.equal(p.data.paymentStatus,status);
    if(status==='PAID')assert.match(p.data.paymentHint,/付款已确认/);
    else if(status==='PAYMENT_REVIEW')assert.match(p.data.paymentHint,/请勿重复付款/);
    else assert.match(p.data.paymentHint,kind==='failure'?/暂时无法核对/:/稍后刷新/);
  }
});
test('unloaded query does not reread or update a departed page',async t=>{
  let done;t.mock.method(service,'refreshPayment',()=>new Promise(resolve=>{done=resolve;}));
  const read=t.mock.method(service,'getOrder',async()=>order());
  const p=page();const query=p.refreshCloudPayment();p.onUnload();p.setData=()=>assert.fail('unloaded update');
  done({queryStatus:'QUERIED'});await query;assert.equal(read.mock.callCount(),0);
});
test('ordinary page reads remain read-only; only eligible pull-down refresh calls the query',async t=>{
  const query=t.mock.method(service,'refreshPayment',async()=>({queryStatus:'THROTTLED'}));
  t.mock.method(service,'getOrder',async()=>order());
  const p=page();await p.loadOrder();assert.equal(query.mock.callCount(),0);
  await p.onPullDownRefresh();assert.equal(query.mock.callCount(),1);
});
test('client query sends only action and order id and validates the response status',async()=>{
  const service=connectedService();
  let sent;global.wx.cloud={callFunction:async request=>{sent=request;return {result:{ok:true,data:{queryStatus:'THROTTLED'}}};}};
  await service.refreshPayment('order_1');
  assert.deepEqual(JSON.parse(JSON.stringify(sent)),{name:'payment-api',data:{action:'refreshPayment',orderId:'order_1'}});
  global.wx.cloud.callFunction=async()=>({result:{ok:true,data:{queryStatus:'PAID'}}});
  await assert.rejects(service.refreshPayment('order_1'));
});

test('client creation sends stable order/version key and rejects unknown server states',async()=>{
  const service=connectedService();
  const sent=[];
  global.wx.cloud={callFunction:async request=>{sent.push(request);return {result:{ok:true,data:{status:'QUERY_REQUIRED'}}};}};
  await service.createPayment('order_1',3);await service.createPayment('order_1',3);
  assert.deepEqual(sent[0],sent[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])),{name:'payment-api',data:{action:'createPayment',orderId:'order_1',expectedVersion:3,requestKey:'payment-order_1-version-3'}});
  global.wx.cloud.callFunction=async()=>({result:{ok:true,data:{status:'invented'}}});
  await assert.rejects(service.createPayment('order_1',3));
});

global.getApp=()=>null;
test('query, order read and transition discard old-session success and failure',async t=>{
 for(const action of ['refreshCloudPayment','loadOrder','runTransition'])for(const failed of [false,true])for(const renewed of [false,true]){
  const app={globalData:{account:{id:'buyer-a'}},sessionRevision:1};t.mock.method(global,'getApp',()=>app);
  let resolve,reject,after=0;const waiting=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const method=action==='refreshCloudPayment'?'refreshPayment':action==='loadOrder'?'getOrder':'transitionOrder';
  const stub=t.mock.method(service,method,()=>waiting);
  let read;
  if(action!=='loadOrder')read=t.mock.method(service,'getOrder',async()=>{assert.fail('old session must not read follow-up order');});
  const p=page(),pending=action==='runTransition'?p.runTransition('BUYER_CONFIRM',{},()=>after++):p[action]();
  if(renewed)app.sessionRevision++;else app.globalData.account={id:'buyer-b'};
  p.setData=()=>assert.fail('old session must not update page');
  if(failed)reject(Object.assign(Error('changed'),{code:'VERSION_CONFLICT'}));
  else resolve(action==='refreshCloudPayment'?{queryStatus:'QUERIED'}:order({version:2}));
  await pending;assert.equal(after,0);stub.mock.restore();if(read)read.mock.restore();
 }
});

test('current verified session still reads, transitions and invokes its completion once',async t=>{
 const app={globalData:{account:{id:'buyer-a'}},sessionRevision:1};t.mock.method(global,'getApp',()=>app);
 t.mock.method(service,'getOrder',async()=>order({version:2}));
 t.mock.method(service,'transitionOrder',async()=>order({version:3,stage:'IN_PRODUCTION',paymentStatus:'PAID'}));
 const p=page();await p.loadOrder();assert.equal(p.data.order.version,2);
 let after=0;await p.runTransition('TEST',{},()=>after++);
 assert.equal(after,1);assert.equal(p.data.order.version,3);assert.equal(p.data.actionPending,false);
 app.globalData.account=null;
 const read=t.mock.method(service,'getOrder',async()=>assert.fail('no authenticated session'));
 await p.loadOrder();await p.refreshCloudPayment();await p.runTransition('TEST');await p.startCloudPayment();
 assert.equal(read.mock.callCount(),0);
});
