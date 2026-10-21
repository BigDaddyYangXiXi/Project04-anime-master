const test = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../miniprogram/services/cloud-orders');
let definition;
global.Page = value => { definition = value; };
require('../miniprogram/pages/review/index');
delete global.Page;
const order = version => ({id:'review-order',version,cloudOrder:true,provider:'服务方',stage:'COMPLETED',rating:0});
function page() {
  const p = {...definition,cloudMode:true,orderId:'review-order',data:structuredClone(definition.data)};
  p.setData = patch => Object.assign(p.data,patch);
  p.renderOrder(order(3));
  p.data.rating=4;p.data.text='沟通清楚';
  return p;
}
function pending() { let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
test('评价确认绑定原订单，取消与过期不提交，正常确认仍提交',()=>{
  for(const state of ['current','changed','cancel']){
    const p=page();let modal,calls=0;
    global.wx={showModal:value=>{modal=value;},showToast(){}};
    p.submitCloudReview=()=>{calls++;};p.submit();
    if(state==='changed')p.data.order=order(4);
    modal.success({confirm:state!=='cancel'});
    assert.equal(calls,state==='current'?1:0);
  }
});
test('评价读取及提交离页后成功或失败不更新旧页',async t=>{
  for(const action of ['load','submitCloudReview'])for(const failed of [false,true]){
    const p=page(),response=pending();
    global.wx={showToast:()=>assert.fail('离页后不得提示')};
    t.mock.method(cloud,action==='load'?'getOrder':'transitionOrder',()=>response.promise);
    const request=p[action]();p.onUnload();
    let writes=0,reads=0;
    p.setData=()=>{writes++;};p.load=()=>{reads++;};
    if(failed)response.reject(Object.assign(Error('conflict'),{code:'VERSION_CONFLICT'}));else response.resolve(order(4));
    await request;
    assert.equal(writes,0);assert.equal(reads,0);
  }
});
test('较早读取不覆盖已提交的评价',async t=>{
  const p=page(),response=pending();
  t.mock.method(cloud,'getOrder',()=>response.promise);
  const read=p.load();
  p.renderOrder({...order(4),rating:4,reviewText:'沟通清楚'});
  response.resolve(order(3));await read;
  assert.equal(p.data.order.rating,4);
});
