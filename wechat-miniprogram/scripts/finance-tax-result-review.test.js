const test=require('node:test'),assert=require('node:assert/strict');
const {snapshotHash,reviewFinanceTaxResult}=require('./finance-tax-result-review');
function fixture(){
  const review={batchId:'a'.repeat(32),status:'RESERVED_DRAFT',batchBlockers:[],remainingChecks:[],records:[{
    orderId:'o1',paymentId:'p1',providerId:'provider1',blockers:[],ledgerIssues:[],
    payment:{totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
    currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};
  const input={batchId:review.batchId,sourceSha256:snapshotHash(review),resultId:'result1',evidenceReference:'restricted/finance1',records:[{
    orderId:'o1',paymentId:'p1',providerId:'provider1',taxPeriod:'2026-09',basisReference:'finance-calculation1',
    providerPretaxFen:'8000',incomeTaxFen:'300',vatFen:'0',surchargeFen:'0',providerNetFen:'7700'}]};
  return {review,input};
}
test('manual result keeps taxes separate and never releases funds',()=>{
  const {review,input}=fixture();const result=reviewFinanceTaxResult(review,input,'finance_owner');
  assert.equal(result.records[0].withholdingFen,'300');assert.equal(result.records[0].providerNetFen,'7700');
  assert.equal(result.payable,false);assert.equal(result.status,'VALIDATED_DRAFT');
});
test('refund or fee change invalidates the original financial result',()=>{
  const {review,input}=fixture();Object.assign(review.records[0].payment,{refundedFen:1000});
  Object.assign(review.records[0].currentAmounts,{retainedTotalFen:9000,platformFeeFen:1800,providerPretaxFen:7200});
  assert.throws(()=>reviewFinanceTaxResult(review,input,'finance_owner'),/SOURCE_MISMATCH/);
});
test('missing tax, extra deduction, wrong identity and absent basis are rejected',()=>{
  for(const change of [r=>delete r.vatFen,r=>r.providerNetFen='7600',r=>r.providerId='other',r=>r.basisReference='',r=>r.incomeTaxFen='-1',r=>r.vatFen='1e2']){
    const {review,input}=fixture();change(input.records[0]);assert.throws(()=>reviewFinanceTaxResult(review,input,'finance_owner'));
  }
});
test('explicit zero tax is accepted with financial basis; omitted or duplicate rows fail',()=>{
  const {review,input}=fixture();input.records[0].incomeTaxFen='0';input.records[0].providerNetFen='8000';
  assert.equal(reviewFinanceTaxResult(review,input,'finance_owner').records[0].withholdingFen,'0');
  input.records.push(input.records[0]);assert.throws(()=>reviewFinanceTaxResult(review,input,'finance_owner'),/INCOMPLETE/);
  input.records=[];assert.throws(()=>reviewFinanceTaxResult(review,input,'finance_owner'),/INCOMPLETE/);
});

test('source identities must exist even when the input repeats missing identities',()=>{
  for(const key of ['orderId','paymentId','providerId']){
   for(const invalid of [undefined,'','   ']){
    const {review,input}=fixture();
    review.records[0][key]=invalid;input.records[0][key]=invalid;
    if(key!=='paymentId')input.sourceSha256=snapshotHash(review);
    assert.throws(()=>reviewFinanceTaxResult(review,input,'finance_owner'),/FINANCE_RESULT_SOURCE_INVALID/);
   }
  }
});
