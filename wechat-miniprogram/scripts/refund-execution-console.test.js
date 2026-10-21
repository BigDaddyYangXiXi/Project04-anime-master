const test=require('node:test'),assert=require('node:assert/strict');
const {prepareExecution,applyExecution}=require('./refund-execution-console');
const request={action:'execute',refundId:'a'.repeat(32)};
const row={refundId:request.refundId,orderId:'order',paymentId:'b'.repeat(32),amountFen:3000,totalFen:10000,
  decision:'APPROVE',reviewerId:'reviewer',evidenceReference:'case_1',reviewedAt:100,status:'APPROVED',
  submissionStartedAt:null,holdReason:'REFUND_REQUEST',settlementReviewRequired:false,settlementTaskId:null,paymentStatus:'PAID'};
test('execution plans require approved unfrozen-for-dispute original payment',async()=>{
  for(const patch of [{decision:null},{status:'REQUESTED'},{holdReason:'DISPUTE'},{settlementTaskId:'task'},
    {settlementReviewRequired:true},{paymentStatus:'PAID_REQUIRES_REVIEW'},{submissionStartedAt:200}]) {
    await assert.rejects(prepareExecution(request,{},async()=>({...row,...patch})));
  }
  assert.equal((await prepareExecution(request,{},async()=>row)).snapshot.amountFen,3000);
});
test('changed approval or amount rejects before submission',async()=>{
  const plan=await prepareExecution(request,{},async()=>row);
  for(const patch of [{amountFen:4000},{reviewerId:'other'},{evidenceReference:'new'}]) {
    await assert.rejects(applyExecution(plan,{},async()=>({...row,...patch}),()=>assert.fail()),/REFUND_SNAPSHOT_CHANGED/);
  }
});
test('lost response rereads original refund and never resubmits persisted execution',async()=>{
  const plan=await prepareExecution(request,{},async()=>row);let reads=0,submissions=0;
  const submitted={...row,status:'SUBMITTING',submissionStartedAt:200};
  const result=await applyExecution(plan,{},async()=>++reads===1?row:submitted,async()=>{submissions++;throw Error('timeout');});
  assert.equal(result.submitted,true);assert.equal(result.needsQuery,true);assert.equal(result.channelSuccess,false);assert.equal(submissions,1);
  for(const status of ['SUBMITTING','PROCESSING','ABNORMAL','SUCCESS','CLOSED']) {
    const repeated=await applyExecution(plan,{},async()=>({...submitted,status}),()=>assert.fail());
    assert.equal(repeated.channelSuccess,status==='SUCCESS');
  }
});
test('missing durable submission and failed reread never claim successful execution',async()=>{
  const plan=await prepareExecution(request,{},async()=>row);let submissions=0;
  await assert.rejects(applyExecution(plan,{},async()=>row,async()=>{submissions++;return {status:'PROCESSING'};}),/REFUND_SUBMISSION_NOT_CONFIRMED/);
  assert.equal(submissions,1);let reads=0;
  await assert.rejects(applyExecution(plan,{},async()=>{if(++reads===1)return row;throw Error('offline');},async()=>({})),/offline/);
});
