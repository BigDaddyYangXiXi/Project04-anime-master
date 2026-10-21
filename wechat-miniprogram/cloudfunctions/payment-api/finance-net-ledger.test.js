const test=require('node:test'),assert=require('node:assert/strict');
const {financeNetEntries}=require('./fund-ledger');
const {VERSION,platformFee,refundAllocation}=require('./fee-policy');
function fixture(){
  return {payment:{id:'payment',order_id:'order',provider_id:'provider',payment_mode:'DIRECT',status:'PAID',currency:'CNY',
    fee_rule_version:VERSION,amount_fen:10000,platform_fee_fen:2000,refunded_fen:0,platform_refunded_fen:0,provider_refunded_fen:0},
  result:{paymentId:'payment',orderId:'order',providerId:'provider',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'20',surchargeFen:'2',providerNetFen:'7878'}};
}
test('net conversion preserves platform share and separates each manually supplied tax',()=>{
  const {payment,result}=fixture(),before=JSON.stringify({payment,result});
  assert.deepEqual(financeNetEntries(payment,result),[
    {account:'PROVIDER_PENDING',direction:'DEBIT',amountFen:'8000'},
    {account:'INCOME_TAX_PAYABLE',direction:'CREDIT',amountFen:'100'},
    {account:'VAT_PAYABLE',direction:'CREDIT',amountFen:'20'},
    {account:'SURCHARGE_PAYABLE',direction:'CREDIT',amountFen:'2'},
    {account:'PROVIDER_NET',direction:'CREDIT',amountFen:'7878'}]);
  assert.equal(JSON.stringify({payment,result}),before);
});
test('explicit zero taxes and zero net omit only zero postings',()=>{
  const {payment,result}=fixture();Object.assign(result,{incomeTaxFen:'0',vatFen:'0',surchargeFen:'0',providerNetFen:'8000'});
  assert.deepEqual(financeNetEntries(payment,result).map(row=>row.account),['PROVIDER_PENDING','PROVIDER_NET']);
  Object.assign(result,{incomeTaxFen:'8000',providerNetFen:'0'});
  assert.deepEqual(financeNetEntries(payment,result).map(row=>row.account),['PROVIDER_PENDING','INCOME_TAX_PAYABLE']);
});
test('retained balances use cumulative refund rounding, with no second platform deduction',()=>{
  for(const total of [1,2,3,7,101,10000])for(const refunded of [0,Math.floor(total/2)]){
    const {payment,result}=fixture(),fee=platformFee(total).amountFen;
    const allocation=refunded?refundAllocation({totalFen:total,platformFeeFen:fee,feeRuleVersion:VERSION,previouslyRefundedFen:0,refundFen:refunded}):{platformReversalFen:0,providerReversalFen:0};
    Object.assign(payment,{amount_fen:total,platform_fee_fen:fee,refunded_fen:refunded,platform_refunded_fen:allocation.platformReversalFen,provider_refunded_fen:allocation.providerReversalFen});
    const pretax=String(total-fee-allocation.providerReversalFen);
    Object.assign(result,{providerPretaxFen:pretax,incomeTaxFen:'0',vatFen:'0',surchargeFen:'0',providerNetFen:pretax});
    assert.equal(financeNetEntries(payment,result).at(-1).amountFen,pretax);
  }
});
test('wrong identity, state, fee or refund projection cannot create net entries',()=>{
  for(const change of [p=>p.provider_id='other',p=>p.order_id='other',p=>p.id='other',p=>p.status='CREATING',
    p=>p.payment_mode='COMBINE',p=>p.currency='USD',p=>p.fee_rule_version='other',p=>p.platform_fee_fen=1900,
    p=>p.refunded_fen=1,p=>p.provider_refunded_fen=1,p=>p.amount_fen=Number.MAX_SAFE_INTEGER+1]){
    const {payment,result}=fixture();change(payment);assert.throws(()=>financeNetEntries(payment,result),/FUND_LEDGER/);
  }
});
test('missing taxes, unsafe numbers, extra deductions and fully refunded payments fail',()=>{
  for(const value of [undefined,null,'',-1,'1e2','0.1','9007199254740992']){
    const {payment,result}=fixture();result.vatFen=value;assert.throws(()=>financeNetEntries(payment,result),/FUND_LEDGER/);
  }
  const {payment,result}=fixture();result.providerNetFen='7877';assert.throws(()=>financeNetEntries(payment,result),/FUND_LEDGER/);
  Object.assign(payment,{refunded_fen:10000,platform_refunded_fen:2000,provider_refunded_fen:8000});
  for(const key of ['providerPretaxFen','incomeTaxFen','vatFen','surchargeFen','providerNetFen'])result[key]='0';
  assert.throws(()=>financeNetEntries(payment,result),/FUND_LEDGER/);
});
