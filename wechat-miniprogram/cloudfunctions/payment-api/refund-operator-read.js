// Operator-only snapshot. Do not expose payer identity, credentials or raw payment payloads.
async function readOperatorRefund(pool, id, config) {
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)
    || typeof config?.appid !== 'string' || !config.appid
    || typeof config.platformMchid !== 'string' || !config.platformMchid) throw Error('REFUND_OPERATOR_INPUT_INVALID');
  const [[row]] = await pool.execute(`SELECT f.id,f.order_id,f.payment_id,f.amount_fen,f.total_fen,f.reason,f.status,
    f.review_decision,f.reviewed_by,f.evidence_reference,f.reviewed_at,f.created_at,f.updated_at,f.succeeded_at,
    f.submission_started_at,f.settlement_review_required,p.status AS payment_status,p.refunded_fen,
    h.hold_reason,h.settlement_task_id
    FROM order_refunds f JOIN order_payments p ON p.id=f.payment_id AND p.order_id=f.order_id
    JOIN order_aggregates o ON o.id=f.order_id
    LEFT JOIN order_funds_interlocks h ON h.order_id=f.order_id
    WHERE f.id=? AND p.appid=? AND p.platform_mchid=? AND f.platform_mchid=p.platform_mchid
      AND p.payment_mode='DIRECT' AND f.payment_mode='DIRECT'`, [id,config.appid,config.platformMchid]);
  if (!row) throw Error('REFUND_NOT_FOUND');
  const number = value => value == null ? null : Number(value);
  return {refundId:row.id,orderId:row.order_id,paymentId:row.payment_id,amountFen:number(row.amount_fen),
    totalFen:number(row.total_fen),refundedFen:number(row.refunded_fen),reason:row.reason,status:row.status,
    paymentStatus:row.payment_status,decision:row.review_decision,reviewerId:row.reviewed_by,
    evidenceReference:row.evidence_reference,reviewedAt:number(row.reviewed_at),createdAt:number(row.created_at),
    updatedAt:number(row.updated_at),succeededAt:number(row.succeeded_at),submissionStartedAt:number(row.submission_started_at),
    settlementReviewRequired:Boolean(row.settlement_review_required),holdReason:row.hold_reason || null,
    settlementTaskId:row.settlement_task_id || null};
}
const STATUSES = ['REQUESTED','APPROVED','REJECTED','SUBMITTING','PROCESSING','SUCCESS','CLOSED','ABNORMAL'];
function validListInput(input) {
  const cursor = input?.cursor;
  return !!input && !Array.isArray(input) && Object.keys(input).every(key => ['status','cursor'].includes(key))
    && STATUSES.includes(input.status) && (cursor == null || typeof cursor === 'object' && !Array.isArray(cursor)
      && Object.keys(cursor).every(key => ['createdAt','id','status'].includes(key)) && cursor.status === input.status
      && Number.isSafeInteger(cursor.createdAt) && cursor.createdAt > 0 && typeof cursor.id === 'string' && /^[a-f0-9]{32}$/.test(cursor.id));
}
async function listOperatorRefunds(pool, input, config) {
  if (!validListInput(input) || typeof config?.appid !== 'string' || !config.appid
    || typeof config.platformMchid !== 'string' || !config.platformMchid) throw Error('REFUND_OPERATOR_INPUT_INVALID');
  const params = [config.appid,config.platformMchid,input.status];
  const after = input.cursor ? 'AND (f.created_at<? OR (f.created_at=? AND f.id<?))' : '';
  if (input.cursor) params.push(input.cursor.createdAt,input.cursor.createdAt,input.cursor.id);
  const [rows] = await pool.execute(`SELECT f.id,f.order_id,f.amount_fen,f.status,f.created_at,f.updated_at
    FROM order_refunds f JOIN order_payments p ON p.id=f.payment_id AND p.order_id=f.order_id
    JOIN order_aggregates o ON o.id=f.order_id
    WHERE p.appid=? AND p.platform_mchid=? AND f.platform_mchid=p.platform_mchid AND f.status=?
      AND p.payment_mode='DIRECT' AND f.payment_mode='DIRECT' ${after}
    ORDER BY f.created_at DESC,f.id DESC LIMIT 21`,params);
  const records = rows.slice(0,20).map(row => ({refundId:row.id,orderId:row.order_id,amountFen:Number(row.amount_fen),
    status:row.status,createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)}));
  const last = records[records.length-1];
  return {records,nextCursor:rows.length > 20 ? {createdAt:last.createdAt,id:last.refundId,status:input.status} : null};
}
module.exports = {readOperatorRefund,listOperatorRefunds,validListInput};
