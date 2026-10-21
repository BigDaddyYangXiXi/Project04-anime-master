const {readBankBatchReview}=require('../cloudfunctions/payment-api/bank-batch-review');
const {reviewFinanceTaxResult}=require('./finance-tax-result-review');
// Read-only preparation. Approval must repeat these checks in its ledger transaction.
async function reviewLiveFinanceResult(pool,scope,input,operatorId,readReview=readBankBatchReview){
  if(scope?.appid!=='wxc94e1c1b38944511'||scope.platformMchid!=='1750932981')throw Error('FINANCE_IMPORT_SCOPE_MISMATCH');
  if(!input||typeof input.batchId!=='string'||!/^[a-f0-9]{32}$/.test(input.batchId))throw Error('FINANCE_RESULT_SOURCE_MISMATCH');
  const current=await readReview(pool,input.batchId,scope);
  if(current.status!=='RESERVED_DRAFT'||current.sourcesUnchanged!==true
    ||!Array.isArray(current.batchBlockers)||current.batchBlockers.length
    ||!Array.isArray(current.records)||!current.records.length
    ||current.records.some(row=>!Array.isArray(row.blockers)||row.blockers.length
      ||!Array.isArray(row.ledgerIssues)||row.ledgerIssues.length))throw Error('FINANCE_LIVE_SOURCE_NOT_READY');
  if(current.records.some(row=>row.payment?.appid!==scope.appid||row.payment?.platformMchid!==scope.platformMchid))throw Error('FINANCE_IMPORT_SCOPE_MISMATCH');
  const result=reviewFinanceTaxResult(current,input,operatorId);
  return {...result,status:'LIVE_RECHECKED_DRAFT',payable:false,
    remainingChecks:['AUTHORIZED_FINANCE_APPROVAL','ATOMIC_LIVE_SOURCE_AND_HOLD_RECHECK','ATOMIC_NET_LEDGER_CREDIT']};
}
module.exports={reviewLiveFinanceResult};
