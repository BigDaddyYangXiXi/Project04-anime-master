function validReviewCursor(cursor) {
  return cursor == null || typeof cursor==='object'&&!Array.isArray(cursor)
    && Object.keys(cursor).every(key=>['paidAt','id'].includes(key))
    && Number.isSafeInteger(cursor.paidAt)&&cursor.paidAt>0&&typeof cursor.id==='string'&&/^[a-f0-9]{32}$/.test(cursor.id);
}
// Operator-only unresolved receipts, not an income or withdrawal list.
async function listPaymentReviews(pool,cursor,config) {
  if(!validReviewCursor(cursor)||typeof config?.appid!=='string'||!config.appid
    ||typeof config.platformMchid!=='string'||!config.platformMchid)throw Error('PAYMENT_REVIEW_INPUT_INVALID');
  const params=[config.appid,config.platformMchid];
  const after=cursor?'AND (paid_at<? OR (paid_at=? AND id<?))':'';
  if(cursor)params.push(cursor.paidAt,cursor.paidAt,cursor.id);
  const [rows]=await pool.execute(`SELECT id,order_id,amount_fen,currency,received_total_fen,received_currency,
    payer_paid_fen,review_reason,payer_verification,paid_at FROM order_payments
    WHERE appid=? AND platform_mchid=? AND payment_mode='DIRECT' AND status='PAID_REQUIRES_REVIEW'
      AND transaction_id IS NOT NULL ${after} ORDER BY paid_at DESC,id DESC LIMIT 21`,params);
  const records=rows.slice(0,20).map(row=>({paymentId:row.id,orderId:row.order_id,
    expectedAmountFen:Number(row.amount_fen),expectedCurrency:row.currency,receivedAmountFen:Number(row.received_total_fen),
    receivedCurrency:row.received_currency,payerPaidFen:Number(row.payer_paid_fen),reason:row.review_reason,
    payerVerification:row.payer_verification,paidAt:Number(row.paid_at)}));
  const last=records[records.length-1];
  return {records,nextCursor:rows.length>20?{paidAt:last.paidAt,id:last.paymentId}:null};
}
module.exports={validReviewCursor,listPaymentReviews};
