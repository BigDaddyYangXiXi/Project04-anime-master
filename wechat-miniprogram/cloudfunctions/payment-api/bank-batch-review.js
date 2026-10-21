const crypto = require('node:crypto');
const { inspectBankOrder } = require('./bank-settlement-preview');
const { auditFundsInSnapshot } = require('./fund-audit');
// Caller owns the transaction and any write-path locks; this helper never commits or releases it.
async function readBankBatchSnapshot(connection,batchId,config) {
  if(typeof batchId!=='string'||!/^[a-f0-9]{32}$/.test(batchId)
    ||typeof config?.appid!=='string'||!config.appid||typeof config.platformMchid!=='string'||!config.platformMchid)throw Error('BANK_BATCH_INPUT_INVALID');
    const [[batch]]=await connection.execute('SELECT id,status,request_hash,created_by FROM bank_settlement_batches WHERE id=? AND appid=? AND platform_mchid=?',
      [batchId,config.appid,config.platformMchid]);
    if(!batch)throw Error('BANK_BATCH_NOT_FOUND');
    const [sources]=await connection.execute('SELECT * FROM bank_settlement_sources WHERE batch_id=? ORDER BY order_id',[batchId]);
    const sourceHash=crypto.createHash('sha256').update(JSON.stringify([sources.map(row=>row.payment_id).sort(),batch.created_by])).digest('hex');
    const batchBlockers=sourceHash===batch.request_hash?[]:['BATCH_SOURCES_MISMATCH'];
    const records=[];
    for(const source of sources){
      const blockers=[];
      if(batch.status!=='RESERVED_DRAFT')blockers.push('BATCH_NOT_RESERVED_DRAFT');
      if(source.released_at!==null)blockers.push('SOURCE_RELEASED');
      const [[payment]]=await connection.execute(`SELECT p.*,o.provider_id,o.stage AS order_stage,o.version AS current_order_version,o.payload AS order_payload
        FROM order_payments p JOIN order_aggregates o ON o.id=p.order_id
        WHERE p.id=? AND p.order_id=? AND p.appid=? AND p.platform_mchid=? AND p.payment_mode='DIRECT'`,
        [source.payment_id,source.order_id,config.appid,config.platformMchid]);
      let amounts=null,ledgerIssues=[];
      if(!payment)blockers.push('SOURCE_PAYMENT_MISSING');
      else {
        const [refunds]=await connection.execute('SELECT status FROM order_refunds WHERE payment_id=?',[payment.id]);
        const [[interlock]]=await connection.execute('SELECT hold_reason,settlement_task_id FROM order_funds_interlocks WHERE order_id=?',[payment.order_id]);
        const inspected=inspectBankOrder(payment,refunds,interlock);amounts=inspected.amounts;blockers.push(...inspected.blockers);
        const audit=await auditFundsInSnapshot(connection,payment);
        ledgerIssues=audit.issues;
        if(!audit.ok)blockers.push('LEDGER_MISMATCH');
        const snapshot=typeof source.snapshot==='string'?JSON.parse(source.snapshot):source.snapshot;
        const current={paymentId:payment.id,orderId:payment.order_id,providerId:payment.provider_id,
          orderVersion:String(payment.current_order_version),refundedFen:String(payment.refunded_fen),...amounts};
        if(!snapshot||!amounts||Object.keys(current).some(key=>snapshot[key]!==current[key])
          ||source.provider_id!==payment.provider_id||Number(source.provider_pretax_fen)!==amounts.providerPretaxFen)blockers.push('SOURCE_SNAPSHOT_CHANGED');
      }
      records.push({orderId:source.order_id,paymentId:source.payment_id,providerId:source.provider_id,
        payment:payment?{transactionId:payment.transaction_id,status:payment.status,orderStage:payment.order_stage,
          appid:payment.appid,platformMchid:payment.platform_mchid,
          currency:payment.currency,totalFen:String(payment.amount_fen),receivedTotalFen:String(payment.received_total_fen),
          payerPaidFen:String(payment.payer_paid_fen),refundedFen:String(payment.refunded_fen),
          originalPlatformFeeFen:String(payment.platform_fee_fen),paidAt:String(payment.paid_at)}:null,
        reservedProviderPretaxFen:Number(source.provider_pretax_fen),currentAmounts:amounts,blockers,ledgerIssues});
    }
    return {batchId,status:batch.status,payable:false,
      sourcesUnchanged:batchBlockers.length===0&&records.length>0&&records.every(row=>row.blockers.length===0),batchBlockers,records,
      remainingChecks:['PRIOR_PAYOUT_AND_CHANNEL_BALANCE_CHECK_REQUIRED','BANK_ACCOUNT_AND_TAX_CHECK_REQUIRED','ATOMIC_EXPORT_RECHECK_REQUIRED']};
}
// Read-only review of reservation freshness, not approval or a bank export authorization.
async function readBankBatchReview(pool,batchId,config) {
  if(typeof batchId!=='string'||!/^[a-f0-9]{32}$/.test(batchId)
    ||typeof config?.appid!=='string'||!config.appid||typeof config.platformMchid!=='string'||!config.platformMchid)throw Error('BANK_BATCH_INPUT_INVALID');
  const connection=await pool.getConnection();let reusable=true;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION READ ONLY');
    const result=await readBankBatchSnapshot(connection,batchId,config);
    await connection.commit();
    return result;
  }catch(error){try{await connection.rollback();}catch{reusable=false;}throw error;}
  finally{if(reusable)connection.release();else connection.destroy();}
}
module.exports={readBankBatchReview,readBankBatchSnapshot};
