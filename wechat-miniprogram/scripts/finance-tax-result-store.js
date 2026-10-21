const crypto=require('node:crypto');
const {reviewFinanceTaxResult}=require('./finance-tax-result-review');
const {financeResultFingerprint}=require('../cloudfunctions/payment-api/finance-result-fingerprint');
// Imported financial evidence only. Approval must re-read live sources and credit the ledger atomically.
async function saveFinanceResult(pool,scope,review,input,operatorId){
  for(const key of ['appid','platformMchid'])if(!/^[A-Za-z0-9_-]{1,64}$/.test(scope?.[key]||''))throw Error('FINANCE_IMPORT_SCOPE_INVALID');
  const result=reviewFinanceTaxResult(review,input,operatorId);
  if(review.records.some(row=>row.payment?.appid!==scope.appid||row.payment?.platformMchid!==scope.platformMchid))throw Error('FINANCE_IMPORT_SCOPE_MISMATCH');
  result.records.sort((a,b)=>a.paymentId<b.paymentId?-1:a.paymentId>b.paymentId?1:0);
  const snapshot=JSON.stringify(result),hash=financeResultFingerprint(result);
  const connection=await pool.getConnection();let reusable=true;
  try{
    await connection.beginTransaction();
    await connection.execute(`INSERT INTO finance_result_imports
      (id,appid,platform_mchid,result_id,batch_id,source_sha256,result_sha256,result_snapshot,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
    [crypto.randomBytes(16).toString('hex'),scope.appid,scope.platformMchid,result.resultId,result.batchId,result.sourceSha256,hash,snapshot,operatorId,Date.now()]);
    const [[row]]=await connection.execute(`SELECT id,result_sha256 FROM finance_result_imports
      WHERE appid=? AND platform_mchid=? AND result_id=? FOR UPDATE`,[scope.appid,scope.platformMchid,result.resultId]);
    if(!row||row.result_sha256!==hash)throw Error('FINANCE_IMPORT_CONFLICT');
    await connection.commit();
    return {id:row.id,resultId:result.resultId,status:'IMPORTED_PENDING_REVIEW',payable:false};
  }catch(error){try{await connection.rollback();}catch{reusable=false;}throw error;}
  finally{if(reusable)connection.release();else connection.destroy();}
}
// Caller owns the transaction and must lock/recheck live sources before any approval.
async function readFinanceResult(connection,scope,importId,review){
  for(const key of ['appid','platformMchid'])if(!/^[A-Za-z0-9_-]{1,64}$/.test(scope?.[key]||''))throw Error('FINANCE_IMPORT_SCOPE_INVALID');
  if(typeof importId!=='string'||!/^[a-f0-9]{32}$/.test(importId))throw Error('FINANCE_IMPORT_ID_INVALID');
  const [[row]]=await connection.execute(`SELECT id,appid,platform_mchid,result_id,batch_id,source_sha256,
    result_sha256,result_snapshot,created_by FROM finance_result_imports
    WHERE id=? AND appid=? AND platform_mchid=?`,[importId,scope.appid,scope.platformMchid]);
  if(!row)throw Error('FINANCE_IMPORT_NOT_FOUND');
  if(row.id!==importId||row.appid!==scope.appid||row.platform_mchid!==scope.platformMchid)throw Error('FINANCE_IMPORT_SCOPE_MISMATCH');
  let input;
  try{input=typeof row.result_snapshot==='string'?JSON.parse(row.result_snapshot):row.result_snapshot;}
  catch{throw Error('FINANCE_IMPORT_SNAPSHOT_INVALID');}
  if(!input||input.resultId!==row.result_id||input.batchId!==row.batch_id
    ||input.sourceSha256!==row.source_sha256||input.operatorId!==row.created_by
    ||input.status!=='VALIDATED_DRAFT'||input.payable!==false)throw Error('FINANCE_IMPORT_SNAPSHOT_INVALID');
  if(financeResultFingerprint(input)!==row.result_sha256)throw Error('FINANCE_IMPORT_HASH_MISMATCH');
  const result=reviewFinanceTaxResult(review,input,row.created_by);
  if(review.records.some(item=>item.payment?.appid!==scope.appid||item.payment?.platformMchid!==scope.platformMchid))throw Error('FINANCE_IMPORT_SCOPE_MISMATCH');
  // MySQL JSON may reorder object keys; rebuild the original normalized representation.
  result.records.sort((a,b)=>a.paymentId<b.paymentId?-1:a.paymentId>b.paymentId?1:0);
  const hash=financeResultFingerprint(result);
  if(hash!==row.result_sha256)throw Error('FINANCE_IMPORT_HASH_MISMATCH');
  return {id:row.id,result,status:'IMPORTED_PENDING_REVIEW',payable:false};
}
module.exports={saveFinanceResult,readFinanceResult};
