const test=require('node:test'),assert=require('node:assert/strict');
const {prepareReview,applyReview}=require('./refund-review-console');
const deployment={functions:[{name:'payment-refund-operator',envVariables:{PAYMENT_REFUND_REVIEWER_ID:'reviewer_1'}}]};
const request={action:'review',refundId:'a'.repeat(32),decision:'APPROVE',evidenceReference:'case_1'};
const pending={refundId:request.refundId,orderId:'order_1',paymentId:'b'.repeat(32),amountFen:3000,totalFen:10000,
  reason:'退款',createdAt:100,status:'REQUESTED',decision:null};
const approved={...pending,status:'APPROVED',decision:'APPROVE',reviewerId:'reviewer_1',evidenceReference:'case_1'};
test('prepare is read-only and technical query identity cannot prepare reviews',async()=>{
  const plan=await prepareReview(request,deployment,async()=>pending);
  assert.equal(plan.snapshot.amountFen,3000);assert.equal(plan.reviewerId,'reviewer_1');
  await assert.rejects(prepareReview(request,{functions:[{name:'payment-refund-operator',envVariables:{PAYMENT_REFUND_REVIEWER_ID:'refund_query_service'}}]},()=>assert.fail()),/REVIEWER_NOT_CONFIGURED/);
});
test('apply checks original facts and reviewer before submitting',async()=>{
  const plan=await prepareReview(request,deployment,async()=>pending);
  await assert.rejects(applyReview(plan,deployment,async()=>({...pending,amountFen:4000}),()=>assert.fail()),/REVIEW_SNAPSHOT_CHANGED/);
  await assert.rejects(applyReview({...plan,reviewerId:'another'},deployment,()=>assert.fail(),()=>assert.fail()),/REVIEWER_CHANGED/);
});
test('lost submission response is resolved by persisted decision, never a second submission',async()=>{
  const plan=await prepareReview(request,deployment,async()=>pending);let reads=0,submissions=0;
  const result=await applyReview(plan,deployment,async()=>++reads===1?pending:approved,async()=>{submissions++;throw Error('timeout');});
  assert.equal(result.confirmed,true);assert.equal(submissions,1);assert.equal(reads,2);
  const repeated=await applyReview(plan,deployment,async()=>approved,()=>assert.fail());
  assert.equal(repeated.alreadyRecorded,true);
});
test('different decision, unpersisted response and failed reread never claim approval',async()=>{
  const plan=await prepareReview(request,deployment,async()=>pending);
  await assert.rejects(applyReview(plan,deployment,async()=>({...approved,decision:'REJECT'}),()=>assert.fail()),/REVIEW_CONFLICT/);
  let submissions=0;
  await assert.rejects(applyReview(plan,deployment,async()=>pending,async()=>{submissions++;return {status:'APPROVED'};}),/REVIEW_NOT_CONFIRMED/);
  assert.equal(submissions,1);
  let reads=0;
  await assert.rejects(applyReview(plan,deployment,async()=>{if(++reads===1)return pending;throw Error('unavailable');},async()=>({})),/unavailable/);
});
