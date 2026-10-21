const { withdrawalReceiptHash } = require('../cloudfunctions/payment-api/withdrawal-receipt-hash');
const { withdrawalProgress } = require('../cloudfunctions/payment-api/withdrawal-progress');
const { assertWithdrawalReceiptEvidence } = require('../cloudfunctions/payment-api/withdrawal-receipt-evidence');
// Restricted finance operation after checking bank evidence. No bank request or public action.
// A successful result attests the full payment, including its recipient account version.
async function recordWithdrawalReceipt(pool,input,config) {
  if (!input || ['eventId','requestId','paymentId','accountVersionId'].some(k=>typeof input[k]!=='string'||!/^[a-f0-9]{32}$/.test(input[k]))
    || ['providerId','operatorId'].some(k=>typeof input[k]!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(input[k]))
    || !/^[1-9][0-9]{0,19}$/.test(input.amountFen||'') || typeof input.amountFen!=='string'
    || !['PROCESSING','UNKNOWN','SUCCEEDED','FAILED'].includes(input.status)
    || typeof input.evidenceReference!=='string' || !input.evidenceReference.trim() || input.evidenceReference.length>128
    || ['appid','platformMchid'].some(k=>typeof config?.[k]!=='string'||!config[k])
    || (['SUCCEEDED','FAILED'].includes(input.status) && input.bankResultVerified!==true)
    || (input.status==='SUCCEEDED' && (typeof input.bankTransactionReference!=='string'||!/^[A-Za-z0-9_:-]{1,128}$/.test(input.bankTransactionReference)))
    || (input.status!=='SUCCEEDED' && input.bankTransactionReference!=null)) throw Error('WITHDRAWAL_RECEIPT_INVALID');
  const hash=withdrawalReceiptHash(input,config);
  const connection=await pool.getConnection();let reusable=true;
  try {
    await connection.beginTransaction();
    const [[request]]=await connection.execute(`SELECT CAST(approved_net_fen AS CHAR) AS approved_net_fen FROM withdrawal_requests
      WHERE id=? AND provider_id=? AND appid=? AND platform_mchid=? FOR UPDATE`,[input.requestId,input.providerId,config.appid,config.platformMchid]);
    if (!request || request.approved_net_fen===null) throw Error('WITHDRAWAL_RECEIPT_REQUEST_NOT_READY');
    const [parts]=await connection.execute(`SELECT id,status,account_version_id,CAST(amount_fen AS CHAR) AS amountFen
      FROM withdrawal_bank_payments WHERE withdrawal_id=? ORDER BY id FOR UPDATE`,[input.requestId]);
    const payment=parts.find(part=>part.id===input.paymentId);
    if (!payment || payment.account_version_id!==input.accountVersionId || payment.amountFen!==input.amountFen) throw Error('WITHDRAWAL_RECEIPT_MISMATCH');
    // Same request/parts lock order as reservations. Never normalize a corrupt total via a receipt.
    withdrawalProgress(request.approved_net_fen,parts);
    await assertWithdrawalReceiptEvidence(connection,input.requestId,input.providerId,parts,config);
    const [[prior]]=await connection.execute('SELECT input_sha256 FROM withdrawal_receipt_events WHERE id=?',[input.eventId]);
    if (prior) {
      if (prior.input_sha256!==hash) throw Error('WITHDRAWAL_RECEIPT_CONFLICT');
      await connection.commit();return {eventId:input.eventId,paymentId:input.paymentId,status:payment.status};
    }
    const transitions={EXPORTED:['PROCESSING','UNKNOWN','SUCCEEDED','FAILED'],PROCESSING:['UNKNOWN','SUCCEEDED','FAILED'],UNKNOWN:['SUCCEEDED','FAILED']};
    if (!transitions[payment.status]?.includes(input.status)) throw Error('WITHDRAWAL_RECEIPT_TRANSITION_INVALID');
    const now=Date.now();
    await connection.execute(`INSERT INTO withdrawal_receipt_events
      (id,payment_id,platform_mchid,bank_transaction_reference,input_sha256,previous_status,resulting_status,operator_id,evidence_reference,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,[input.eventId,input.paymentId,config.platformMchid,input.bankTransactionReference||null,hash,payment.status,input.status,input.operatorId,input.evidenceReference,now]);
    await connection.execute('UPDATE withdrawal_bank_payments SET status=?,evidence_reference=?,updated_at=? WHERE id=?',
      [input.status,input.evidenceReference,now,input.paymentId]);
    await connection.commit();
    return {eventId:input.eventId,paymentId:input.paymentId,status:input.status};
  } catch(error) {
    try {await connection.rollback();} catch {reusable=false;}
    if(error.code==='ER_DUP_ENTRY')throw Error('WITHDRAWAL_RECEIPT_CONFLICT');
    throw error;
  } finally {if(reusable)connection.release();else connection.destroy();}
}
module.exports={recordWithdrawalReceipt};
