const test=require('node:test'),assert=require('node:assert/strict');
const {snapshotHash}=require('./finance-tax-result-review');
const {reviewLiveFinanceResult}=require('./finance-result-live-review');
function fixture(){
  const scope={appid:'wxc94e1c1b38944511',platformMchid:'1750932981'};
  const review={batchId:'a'.repeat(32),status:'RESERVED_DRAFT',sourcesUnchanged:true,batchBlockers:[],remainingChecks:[],records:[{
    orderId:'o',paymentId:'p',providerId:'s',blockers:[],ledgerIssues:[],payment:{...scope,totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
    currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};
  const input={batchId:review.batchId,sourceSha256:snapshotHash(review),resultId:'r',evidenceReference:'e',records:[{
    orderId:'o',paymentId:'p',providerId:'s',taxPeriod:'2026-09',basisReference:'b',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]};
  let reads=0;
  return {review,input,scope,reads:()=>reads,run:()=>reviewLiveFinanceResult({},scope,input,'finance',async(_pool,batchId,target)=>{
    reads++;assert.equal(batchId,review.batchId);assert.equal(target,scope);return review;
  })};
}
test('reads current source and returns only a draft, never payout approval',async()=>{
  const f=fixture(),result=await f.run();assert.equal(f.reads(),1);
  assert.equal(result.status,'LIVE_RECHECKED_DRAFT');assert.equal(result.payable,false);
  assert.ok(result.remainingChecks.includes('ATOMIC_LIVE_SOURCE_AND_HOLD_RECHECK'));
});
test('refund, fee change, freeze, released reservation and ledger issues invalidate stale results',async()=>{
  for(const change of [
    r=>{r.records[0].payment.refundedFen=1000;Object.assign(r.records[0].currentAmounts,{retainedTotalFen:9000,platformFeeFen:1800,providerPretaxFen:7200});},
    r=>Object.assign(r.records[0].currentAmounts,{platformFeeFen:2500,providerPretaxFen:7500}),
    r=>r.records[0].blockers.push('DISPUTE_HOLD'),r=>r.status='CANCELLED',
    r=>r.sourcesUnchanged=false,r=>r.records[0].ledgerIssues.push({code:'MISMATCH'})]){
    const f=fixture();change(f.review);await assert.rejects(f.run());
  }
});
test('scope mismatch rejects before querying and source-reader errors propagate',async()=>{
  const f=fixture();f.scope.appid='other';await assert.rejects(f.run(),/SCOPE_MISMATCH/);assert.equal(f.reads(),0);
  const g=fixture();await assert.rejects(reviewLiveFinanceResult({},g.scope,g.input,'finance',async()=>{throw Error('READ_FAILED');}),/READ_FAILED/);
});
