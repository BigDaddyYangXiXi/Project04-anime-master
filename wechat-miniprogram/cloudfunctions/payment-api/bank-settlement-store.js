const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const { inspectBankOrder } = require('./bank-settlement-preview');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Internal draft reservation. Not exported by any cloud entry; no bank submission/approval exists here.
// A refund may still invalidate a reserved draft. Export must revalidate under the same order locks.
async function reserveBankBatch(pool, input, config, now = Date.now()) {
  if (!input || Object.keys(input).some(k=>!['requestKey','paymentIds','operatorId'].includes(k))
    || typeof input.requestKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestKey)
    || typeof input.operatorId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.operatorId)
    || !Array.isArray(input.paymentIds) || !input.paymentIds.length || input.paymentIds.length > 100
    || input.paymentIds.some(id=>typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))
    || new Set(input.paymentIds).size!==input.paymentIds.length
    || !Number.isSafeInteger(now) || now<=0
    || typeof config?.appid!=='string'||!config.appid||config.appid.length>64
    || typeof config.platformMchid!=='string'||!config.platformMchid||config.platformMchid.length>32) fail('BANK_BATCH_INPUT_INVALID');
  const ids=[...input.paymentIds].sort();
  const hash=crypto.createHash('sha256').update(JSON.stringify([ids,input.operatorId])).digest('hex');
  return inTransaction(pool,async connection=>{
    const id=crypto.randomBytes(16).toString('hex');
    await connection.execute(`INSERT INTO bank_settlement_batches(id,request_key,appid,platform_mchid,request_hash,created_by,created_at)
      VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,[id,input.requestKey,config.appid,config.platformMchid,hash,input.operatorId,now]);
    const [[batch]]=await connection.execute(`SELECT * FROM bank_settlement_batches
      WHERE appid=? AND platform_mchid=? AND request_key=? FOR UPDATE`,[config.appid,config.platformMchid,input.requestKey]);
    if(batch.request_hash!==hash)fail('BANK_BATCH_IDEMPOTENCY_CONFLICT');
    if(batch.id!==id)return {batchId:batch.id,status:batch.status,payable:false};
    // Discover the immutable order binding, then lock in the same order as payment/refund mutations.
    const bindings=[];
    for(const paymentId of ids){
      const [[binding]]=await connection.execute("SELECT order_id FROM order_payments WHERE id=? AND appid=? AND platform_mchid=? AND payment_mode='DIRECT'",[paymentId,config.appid,config.platformMchid]);
      if(!binding)fail('PAYMENT_NOT_FOUND');
      bindings.push({paymentId,orderId:binding.order_id});
    }
    bindings.sort((a,b)=>a.orderId<b.orderId?-1:a.orderId>b.orderId?1:0);
    for(const binding of bindings){
      const [[order]]=await connection.execute('SELECT * FROM order_aggregates WHERE id=? FOR UPDATE',[binding.orderId]);
      const [[payment]]=await connection.execute("SELECT * FROM order_payments WHERE id=? AND appid=? AND platform_mchid=? AND payment_mode='DIRECT' FOR UPDATE",[binding.paymentId,config.appid,config.platformMchid]);
      if(!order||!payment||payment.order_id!==order.id)fail('PAYMENT_NOT_FOUND');
      const [[claimed]]=await connection.execute('SELECT batch_id FROM bank_settlement_sources WHERE reserved_payment_id=? OR reserved_order_id=? FOR UPDATE',[payment.id,order.id]);
      if(claimed)fail('BANK_BATCH_SOURCE_RESERVED');
      const [refunds]=await connection.execute('SELECT status FROM order_refunds WHERE payment_id=? FOR UPDATE',[payment.id]);
      const [[interlock]]=await connection.execute('SELECT hold_reason,settlement_task_id FROM order_funds_interlocks WHERE order_id=? FOR UPDATE',[order.id]);
      const {amounts,blockers}=inspectBankOrder({...payment,provider_id:order.provider_id,order_stage:order.stage,
        current_order_version:order.version,order_payload:order.payload},refunds,interlock);
      if(blockers.length)fail('BANK_BATCH_SOURCE_NOT_READY');
      const snapshot={paymentId:payment.id,orderId:order.id,providerId:order.provider_id,orderVersion:String(order.version),
        refundedFen:String(payment.refunded_fen),...amounts};
      await connection.execute(`INSERT INTO bank_settlement_sources(batch_id,payment_id,order_id,provider_id,provider_pretax_fen,snapshot)
        VALUES(?,?,?,?,?,?)`,[batch.id,payment.id,order.id,order.provider_id,amounts.providerPretaxFen,JSON.stringify(snapshot)]);
    }
    return {batchId:batch.id,status:'RESERVED_DRAFT',payable:false};
  });
}
async function cancelBankBatch(pool,input,config,now=Date.now()) {
  if(!input||Object.keys(input).some(k=>!['batchId','operatorId','reason'].includes(k))
    ||typeof input.batchId!=='string'||!/^[a-f0-9]{32}$/.test(input.batchId)
    ||typeof input.operatorId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(input.operatorId)
    ||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>255
    ||!Number.isSafeInteger(now)||now<=0||typeof config?.appid!=='string'||!config.appid
    ||typeof config.platformMchid!=='string'||!config.platformMchid)fail('BANK_BATCH_INPUT_INVALID');
  return inTransaction(pool,async connection=>{
    const [[batch]]=await connection.execute('SELECT * FROM bank_settlement_batches WHERE id=? AND appid=? AND platform_mchid=? FOR UPDATE',
      [input.batchId,config.appid,config.platformMchid]);
    if(!batch)fail('BANK_BATCH_NOT_FOUND');
    if(batch.status==='CANCELLED')return {batchId:batch.id,status:'CANCELLED',payable:false};
    if(batch.status!=='RESERVED_DRAFT')fail('BANK_BATCH_CANNOT_CANCEL');
    // Approval and cancellation hold the same batch lock; recorded net sources need explicit correction.
    const [recorded]=await connection.execute(`SELECT n.payment_id FROM finance_net_settlements n
      JOIN bank_settlement_sources s ON s.payment_id=n.payment_id WHERE s.batch_id=? LIMIT 1`,[batch.id]);
    if(recorded.length)fail('BANK_BATCH_NET_ALREADY_RECORDED');
    if(now<Number(batch.created_at))fail('BANK_BATCH_INPUT_INVALID');
    const [sources]=await connection.execute('SELECT order_id FROM bank_settlement_sources WHERE batch_id=? ORDER BY order_id',[batch.id]);
    for(const source of sources)await connection.execute('SELECT id FROM order_aggregates WHERE id=? FOR UPDATE',[source.order_id]);
    await connection.execute('UPDATE bank_settlement_sources SET released_at=? WHERE batch_id=? AND released_at IS NULL',[now,batch.id]);
    await connection.execute("UPDATE bank_settlement_batches SET status='CANCELLED',cancelled_by=?,cancelled_at=?,cancellation_reason=? WHERE id=?",
      [input.operatorId,now,input.reason,batch.id]);
    return {batchId:batch.id,status:'CANCELLED',payable:false};
  });
}
// Recover a lost creation response without creating or reactivating a reservation.
async function findBankBatch(pool,requestKey,config) {
  if(typeof requestKey!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)
    ||typeof config?.appid!=='string'||!config.appid
    ||typeof config.platformMchid!=='string'||!config.platformMchid)fail('BANK_BATCH_INPUT_INVALID');
  const [[batch]]=await pool.execute(`SELECT id,status FROM bank_settlement_batches
    WHERE appid=? AND platform_mchid=? AND request_key=?`,[config.appid,config.platformMchid,requestKey]);
  return batch?{found:true,batchId:batch.id,status:batch.status,payable:false}:{found:false,payable:false};
}
module.exports={reserveBankBatch,cancelBankBatch,findBankBatch};
