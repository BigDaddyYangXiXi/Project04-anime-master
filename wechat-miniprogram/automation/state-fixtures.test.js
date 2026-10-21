const test=require('node:test');
const assert=require('node:assert/strict');
const {generate}=require('./state-fixtures');
const {allowed}=require('../miniprogram/data/order-machine');
const catalog=require('../design-system/catalog.json');
const {providers}=require('../miniprogram/data/v063');
const data=generate(new Date('2026-09-09T12:00:00Z'));
test('全订单阶段与26路由有测试入口，订单编号唯一且关联有效',()=>{
 assert.equal(new Set(data.orders.map(o=>o.id)).size,data.orders.length);
 for(const stage of Object.keys(allowed)) assert.ok(data.orders.some(o=>o.stage===stage),stage);
 for(const page of catalog.pages) assert.ok(data.scenarios.some(s=>page.route===`pages/${s.page}/index`),page.route);
 for(const scene of data.scenarios) if(String(scene.query.id).startsWith('UI-')&&!String(scene.query.id).startsWith('UI-PROJECT')) assert.ok(data.orders.some(o=>o.id===scene.query.id));
});
test('执行与验收订单已付款，NDA与付款前置一致且无真实支付参数',()=>{
 for(const order of data.orders){
  assert.equal(order.paymentRequest,null);
  assert.equal(order.buyerId,'buyer-ayao');
  const provider=providers.find(p=>p.id===order.providerId);
  assert.equal(order.career,provider.career);
  assert.equal(order.provider,provider.name);
  assert.equal(order.bookingDraft.providerId,provider.id);
  assert.ok(order.serviceItems.every(item=>provider.services.some(service=>service.id===item.id)));
  assert.equal(order.finalPrice,order.serviceItems.reduce((n,item)=>n+item.finalPrice,0));
  assert.ok(order.bookingDraft.endTime>order.bookingDraft.startTime);
  if(['IN_PRODUCTION','DELIVERY_PENDING','REVISION_REQUESTED','COMPLETED'].includes(order.stage)){assert.equal(order.paymentStatus,'PAID');assert.ok(order.buyerAgreementConfirmedAt&&order.paidAt&&order.communicationDone);assert.ok(order.requestedAt<order.buyerAgreementConfirmedAt&&order.buyerAgreementConfirmedAt<order.paidAt);}
  if(['COMPLETED','DELIVERY_PENDING'].includes(order.stage))assert.ok(order.bookingDraft.date<'2026-09-09');
  if(order.stage==='NDA_PROVIDER_PENDING'){assert.equal(order.buyerNdaSigned,true);assert.equal(order.providerNdaSigned,false);}
 }
});
test('重新生成可复现，场景编号唯一，项目关联订单全部存在',()=>{
 assert.deepEqual(data,generate(new Date('2026-09-09T12:00:00Z')));
 assert.equal(new Set(data.scenarios.map(s=>s.id)).size,data.scenarios.length);
 for(const id of data.projects[0].bookingIds)assert.ok(data.orders.some(o=>o.id===id));
 assert.ok(data.orders.some(o=>['IN_PRODUCTION','REVISION_REQUESTED','DELIVERY_PENDING'].includes(o.stage)&&!data.projects[0].bookingIds.includes(o.id)),'保留可关联的执行订单');
});
