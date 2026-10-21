const test=require('node:test'),assert=require('node:assert/strict');
const {main}=require('./finance-result-live-cli');
const {snapshotHash}=require('./finance-tax-result-review');
function fixture(){
  const review={batchId:'a'.repeat(32),status:'RESERVED_DRAFT',sourcesUnchanged:true,batchBlockers:[],remainingChecks:[],records:[{
    orderId:'o',paymentId:'p',providerId:'s',blockers:[],ledgerIssues:[],
    payment:{appid:'wxc94e1c1b38944511',platformMchid:'1750932981',totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
    currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};
  const input={batchId:review.batchId,sourceSha256:snapshotHash(review),resultId:'r',evidenceReference:'e',operatorId:'forged',records:[{
    orderId:'o',paymentId:'p',providerId:'s',taxPeriod:'2026-09',basisReference:'b',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]};
  const deployment={envId:'cloudbase-d2g65rqbvee0bd978',functions:[{name:'payment-refund-operator',envVariables:{BANK_BATCH_OPERATOR_ID:'finance'}}]};
  const writes=[],queries=[];
  const deps={readFileSync:file=>JSON.stringify(file==='input'?input:deployment),runQuery:(query,target)=>{
    assert.equal(target.envId,deployment.envId);queries.push(query);return review;
  },writeFileSync:(...args)=>writes.push(args)};
  return {review,input,deployment,writes,queries,deps};
}
test('live CLI uses only existing read action and configured operator; output is exclusive draft',async()=>{
  const f=fixture(),result=await main(['--review','input','output'],f.deps);
  assert.deepEqual(f.queries,[{action:'bankReview',batchId:f.review.batchId}]);
  assert.equal(JSON.parse(f.writes[0][1]).operatorId,'finance');
  assert.deepEqual(f.writes[0][2],{flag:'wx',mode:0o600});assert.equal(result.payable,false);
  assert.equal(result.status,'LIVE_RECHECKED_DRAFT');
});
test('blocked source or query failure creates no output; bad config never queries',async()=>{
  const f=fixture();f.review.records[0].blockers.push('HOLD');
  await assert.rejects(main(['--review','input','output'],f.deps),/NOT_READY/);assert.equal(f.writes.length,0);
  const g=fixture();g.deps.runQuery=()=>{throw Error('QUERY_FAILED');};
  await assert.rejects(main(['--review','input','output'],g.deps),/QUERY_FAILED/);assert.equal(g.writes.length,0);
  const h=fixture();h.deployment.envId='other';
  await assert.rejects(main(['--review','input','output'],h.deps),/CONFIG_INVALID/);assert.equal(h.queries.length,0);
});
