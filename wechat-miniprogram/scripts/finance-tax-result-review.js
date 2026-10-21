// Internal manual-finance result validation. No tax calculation, database write or funds release.
const crypto=require('node:crypto');
const {financeCsv}=require('./bank-finance-export');
function snapshotHash(review){
  return crypto.createHash('sha256').update(financeCsv(review,'SOURCE_SNAPSHOT')).digest('hex');
}
function fen(value){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('FINANCE_RESULT_AMOUNT_INVALID');
  return BigInt(value);
}
function required(value){return typeof value==='string'&&value.trim().length>0&&value.length<=128;}
function reviewFinanceTaxResult(review,input,operatorId){
  if(!Array.isArray(review?.records)||review.records.some(row=>
    !row||!required(row.orderId)||!required(row.paymentId)||!required(row.providerId)))throw Error('FINANCE_RESULT_SOURCE_INVALID');
  if(!required(operatorId)||!input||input.batchId!==review?.batchId
    ||input.sourceSha256!==snapshotHash(review))throw Error('FINANCE_RESULT_SOURCE_MISMATCH');
  if(!required(input.resultId)||!required(input.evidenceReference)
    ||!Array.isArray(input.records)||input.records.length!==review.records.length)throw Error('FINANCE_RESULT_INCOMPLETE');
  const source=new Map(review.records.map(row=>[row.paymentId,row])),seen=new Set();
  const records=input.records.map(row=>{
    const original=source.get(row.paymentId);
    if(!original||seen.has(row.paymentId)||row.providerId!==original.providerId
      ||row.orderId!==original.orderId||!required(row.basisReference)
      ||!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.taxPeriod||''))throw Error('FINANCE_RESULT_ROW_INVALID');
    seen.add(row.paymentId);
    const pretax=fen(row.providerPretaxFen),incomeTax=fen(row.incomeTaxFen),vat=fen(row.vatFen),surcharge=fen(row.surchargeFen),net=fen(row.providerNetFen);
    if(original.currentAmounts?.providerPretaxFen==null
      ||pretax!==fen(String(original.currentAmounts.providerPretaxFen))
      ||incomeTax+vat+surcharge+net!==pretax)throw Error('FINANCE_RESULT_RECONCILIATION_FAILED');
    // Explicit zero values and a basis are required; missing tax must never mean zero.
    return {orderId:row.orderId,paymentId:row.paymentId,providerId:row.providerId,taxPeriod:row.taxPeriod,
      providerPretaxFen:pretax.toString(),incomeTaxFen:incomeTax.toString(),vatFen:vat.toString(),surchargeFen:surcharge.toString(),
      withholdingFen:(incomeTax+vat+surcharge).toString(),providerNetFen:net.toString(),basisReference:row.basisReference};
  });
  return {resultId:input.resultId,batchId:review.batchId,sourceSha256:input.sourceSha256,operatorId,
    evidenceReference:input.evidenceReference,records,status:'VALIDATED_DRAFT',payable:false,
    remainingChecks:['LIVE_SOURCE_AND_HOLD_RECHECK','AUTHORIZED_FINANCE_APPROVAL','ATOMIC_NET_LEDGER_CREDIT']};
}
module.exports={snapshotHash,reviewFinanceTaxResult};
