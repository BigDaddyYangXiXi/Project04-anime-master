// Internal only. No CLI/cloud action exposes this until refund and withdrawal integration is complete.
const {inTransaction}=require('../cloudfunctions/payment-api/payment-store');
const {readBankBatchSnapshot}=require('../cloudfunctions/payment-api/bank-batch-review');
const {postFinanceNet}=require('../cloudfunctions/payment-api/fund-ledger');
const {readFinanceResult}=require('./finance-tax-result-store');
async function approveFinanceResult(pool,importId,config,now=Date.now()){
  if(typeof importId!=='string'||!/^[a-f0-9]{32}$/.test(importId)
    ||!['appid','platformMchid','operatorId'].every(k=>typeof config?.[k]==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(config[k]))
    ||!Number.isSafeInteger(now)||now<=0)throw Error('FINANCE_APPROVAL_INPUT_INVALID');
  // These immutable bindings are discovery only, not financial approval evidence.
  const [[binding]]=await pool.execute('SELECT batch_id FROM finance_result_imports WHERE id=? AND appid=? AND platform_mchid=?',
    [importId,config.appid,config.platformMchid]);
  if(!binding)throw Error('FINANCE_IMPORT_NOT_FOUND');
  const [bindings]=await pool.execute('SELECT payment_id,order_id FROM bank_settlement_sources WHERE batch_id=? ORDER BY order_id,payment_id',[binding.batch_id]);
  if(!bindings.length||bindings.length>100)throw Error('FINANCE_APPROVAL_SOURCE_INVALID');
  return inTransaction(pool,async connection=>{
    // Same batch-first ordering as cancellation; no consistent read before order/payment locks.
    const [[batch]]=await connection.execute('SELECT id,status FROM bank_settlement_batches WHERE id=? AND appid=? AND platform_mchid=? FOR UPDATE',
      [binding.batch_id,config.appid,config.platformMchid]);
    if(!batch)throw Error('BANK_BATCH_NOT_FOUND');
    const payments=new Map();
    for(const source of bindings){
      const [[order]]=await connection.execute('SELECT id,provider_id FROM order_aggregates WHERE id=? FOR UPDATE',[source.order_id]);
      const [[payment]]=await connection.execute("SELECT * FROM order_payments WHERE id=? AND appid=? AND platform_mchid=? AND payment_mode='DIRECT' FOR UPDATE",[source.payment_id,config.appid,config.platformMchid]);
      if(!order||!payment||payment.order_id!==order.id)throw Error('FINANCE_APPROVAL_SOURCE_INVALID');
      payments.set(payment.id,{...payment,provider_id:order.provider_id});
    }
    const [[stored]]=await connection.execute('SELECT batch_id FROM finance_result_imports WHERE id=? AND appid=? AND platform_mchid=? FOR UPDATE',[importId,config.appid,config.platformMchid]);
    if(!stored||stored.batch_id!==batch.id)throw Error('FINANCE_APPROVAL_SOURCE_INVALID');
    const review=await readBankBatchSnapshot(connection,batch.id,config);
    if(review.status!=='RESERVED_DRAFT'||!review.sourcesUnchanged||review.batchBlockers.length
      ||review.records.length!==payments.size||review.records.some(r=>!payments.has(r.paymentId)||r.blockers.length||r.ledgerIssues.length))throw Error('FINANCE_LIVE_SOURCE_NOT_READY');
    const evidence=await readFinanceResult(connection,config,importId,review);
    const [prior]=await connection.execute('SELECT payment_id,import_id FROM finance_net_settlements WHERE payment_id IN ('+[...payments].map(()=>'?').join(',')+') FOR UPDATE',[...payments.keys()]);
    if(prior.length){
      if(prior.length!==payments.size||prior.some(r=>r.import_id!==importId))throw Error('FINANCE_APPROVAL_CONFLICT');
      return {importId,status:'NET_RECORDED',alreadyRecorded:true,payable:false};
    }
    for(const result of evidence.result.records)await postFinanceNet(connection,payments.get(result.paymentId),importId,evidence.result.sourceSha256,result,config.operatorId,now);
    return {importId,status:'NET_RECORDED',alreadyRecorded:false,payable:false};
  });
}
module.exports={approveFinanceResult};
