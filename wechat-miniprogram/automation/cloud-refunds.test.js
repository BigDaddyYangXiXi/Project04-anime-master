const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const input={orderId:'order_1',paymentId:'a'.repeat(32),requestKey:'refund_draft_00001',amountFen:3000,reason:'协商退款'};
const row={refundId:'b'.repeat(32),orderId:'order_1',amountFen:3000,status:'REQUESTED',createdAt:1,updatedAt:1};
function load(reply,available=true) {
  const calls=[];const sandbox={module:{exports:{}},wx:{cloud:{callFunction:async request=>{calls.push(request);return reply(request);}}},
    require: name => name === "../utils/cloud-call" ? require("../miniprogram/utils/cloud-call") :name==='./cloud-orders'?{isAvailable:()=>available}:{assertCloudAllowed(){}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/cloud-refunds'),'utf8'),sandbox);
  return {...sandbox.module.exports,calls};
}
test('refund client preserves caller key, returns only public fields and never retries unknown submission',async()=>{
  const api=load(async()=>({result:{ok:true,data:{...row,reviewed_by:'private'}}}));
  assert.equal((await api.requestRefund(input)).status,'REQUESTED');assert.equal(api.calls[0].data.requestKey,input.requestKey);
  assert.equal((await api.requestRefund(input)).reviewed_by,undefined);
  const broken=load(async()=>{throw Error('private SDK detail');});
  await assert.rejects(broken.requestRefund(input),error=>error.code==='REFUND_REQUEST_FAILED'&&!error.message.includes('private'));
  assert.equal(broken.calls.length,1);
});
test('refund client rejects forged authority, wrong response binding and unknown state',async()=>{
  const api=load(async()=>({result:{ok:true,data:{...row,orderId:'other'}}}));
  await assert.rejects(api.requestRefund({...input,buyerId:'other'}),{code:'REFUND_INPUT_INVALID'});assert.equal(api.calls.length,0);
  await assert.rejects(api.requestRefund(input),{code:'REFUND_RESPONSE_INVALID'});
  await assert.rejects(load(async()=>({result:{ok:true,data:{...row,status:'MADE_UP'}}})).getRefund(row.refundId),{code:'REFUND_RESPONSE_INVALID'});
});
test('refund lists reject foreign records and invalid cursors instead of hiding errors as empty success',async()=>{
  const api=load(async()=>({result:{ok:true,data:{records:[row],nextCursor:{id:'c'.repeat(32),createdAt:1}}}}));
  await assert.rejects(api.listRefunds('order_1'),{code:'REFUND_RESPONSE_INVALID'});
  await assert.rejects(load(async()=>({result:{ok:false,error:{code:'PRIVATE_SQL',message:'secret'}}})).listRefunds('order_1'),error=>!error.message.includes('secret'));
  const off=load(()=>assert.fail('offline network'),false);
  await assert.rejects(off.listRefunds('order_1'),{code:'CLOUD_UNAVAILABLE'});
});
test('request-key lookup only sends identity fields and rejects mismatched amount',async()=>{
  const key={orderId:input.orderId,paymentId:input.paymentId,requestKey:input.requestKey,amountFen:input.amountFen};
  const api=load(async()=>({result:{ok:true,data:row}}));await api.findRefund(key);
  assert.equal(api.calls[0].data.action,'getRefund');assert.equal(api.calls[0].data.amountFen,undefined);
  await assert.rejects(api.findRefund({...key,amountFen:1}),{code:'REFUND_RESPONSE_INVALID'});
  await assert.rejects(api.findRefund({...key,refundId:row.refundId}),{code:'REFUND_INPUT_INVALID'});
});
