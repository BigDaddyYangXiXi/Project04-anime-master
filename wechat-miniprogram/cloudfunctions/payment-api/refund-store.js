const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const { VERSION, platformFee } = require('./fee-policy');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Internal storage API: the controller must resolve the active buyer and merchant on the server.
// Lock order matches payment/settlement: order -> payment -> refund rows -> funds interlock.
async function requestRefund(pool, input, merchantId, now = Date.now()) {
  if (!input || Object.keys(input).some(key => !['orderId','paymentId','buyerId','requestKey','amountFen','reason'].includes(key))
    || ['orderId','paymentId','buyerId','requestKey'].some(key => typeof input[key] !== 'string')
    || !/^[A-Za-z0-9_-]{1,64}$/.test(input.orderId || '') || !/^[A-Za-z0-9_-]{1,64}$/.test(input.buyerId || '')
    || !/^[a-f0-9]{32}$/.test(input.paymentId || '') || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestKey || '')
    || !Number.isSafeInteger(input.amountFen) || input.amountFen <= 0
    || typeof input.reason !== 'string' || !input.reason.trim() || Buffer.byteLength(input.reason) > 80
    || typeof merchantId !== 'string' || !merchantId || !Number.isSafeInteger(now) || now <= 0) fail('REFUND_INPUT_INVALID');
  return inTransaction(pool, async connection => {
    const [[order]] = await connection.execute('SELECT id,buyer_id,stage FROM order_aggregates WHERE id=? FOR UPDATE', [input.orderId]);
    if (!order || order.buyer_id !== input.buyerId) fail('ORDER_NOT_FOUND');
    const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id=? FOR UPDATE', [input.paymentId]);
    if (!payment || payment.order_id !== order.id || payment.payment_mode !== 'DIRECT'
      || payment.platform_mchid !== merchantId) fail('REFUND_IDENTITY_MISMATCH');
    const [refunds] = await connection.execute('SELECT * FROM order_refunds WHERE payment_id=? ORDER BY id FOR UPDATE', [payment.id]);
    const existing = refunds.find(row => row.request_key === input.requestKey);
    if (existing) {
      if (Number(existing.amount_fen) !== input.amountFen || existing.reason !== input.reason) fail('REFUND_IDEMPOTENCY_CONFLICT');
      return existing;
    }
    if (order.stage === 'COMPLETED') fail('REFUND_ORDER_COMPLETED');
    if (payment.status !== 'PAID' || payment.payer_verification !== 'MATCHED'
      || !payment.transaction_id || payment.currency !== 'CNY') fail('REFUND_PAYMENT_NOT_READY');
    const total = Number(payment.amount_fen), originalFee = Number(payment.platform_fee_fen);
    if (!Number.isSafeInteger(total) || total <= 0 || payment.fee_rule_version !== VERSION
      || originalFee !== platformFee(total).amountFen) fail('REFUND_FEE_SNAPSHOT_MISMATCH');
    const reserved = refunds.filter(row => !['REJECTED','CLOSED'].includes(row.status))
      .reduce((sum, row) => sum + BigInt(row.amount_fen), 0n);
    if (reserved + BigInt(input.amountFen) > BigInt(total)) fail('REFUND_AMOUNT_EXCEEDED');
    await connection.execute(`INSERT INTO order_funds_interlocks(order_id,hold_reason,held_at) VALUES(?,'REFUND_REQUEST',?)
      ON DUPLICATE KEY UPDATE hold_reason=COALESCE(hold_reason,VALUES(hold_reason)),held_at=COALESCE(held_at,VALUES(held_at))`, [order.id, now]);
    const [[hold]] = await connection.execute('SELECT settlement_task_id FROM order_funds_interlocks WHERE order_id=? FOR UPDATE', [order.id]);
    const id = crypto.randomBytes(16).toString('hex');
    await connection.execute(`INSERT INTO order_refunds
      (id,order_id,payment_id,request_key,payment_mode,platform_mchid,transaction_id,amount_fen,total_fen,
        platform_fee_fen,fee_rule_version,currency,reason,status,settlement_review_required,created_at,updated_at)
      VALUES(?,?,?,?,'DIRECT',?,?,?,?,?,?,'CNY',?,'REQUESTED',?,?,?)`,
    [id, order.id, payment.id, input.requestKey, merchantId, payment.transaction_id, input.amountFen, total,
      originalFee, payment.fee_rule_version, input.reason, !!hold.settlement_task_id, now, now]);
    // Invalidate an acceptance prepared before this refund hold was committed.
    await connection.execute('UPDATE order_aggregates SET version=version+1,updated_at=GREATEST(updated_at,?) WHERE id=?', [now, order.id]);
    const [[created]] = await connection.execute('SELECT * FROM order_refunds WHERE id=?', [id]);
    return created;
  });
}
// Internal only: reviewer identity and money-operation authorization must come from trusted server context.
async function reviewRefund(pool, input, now = Date.now()) {
  if (!input || Object.keys(input).some(key => !['refundId','reviewerId','decision','evidenceReference'].includes(key))
    || typeof input.refundId !== 'string' || !/^[a-f0-9]{32}$/.test(input.refundId)
    || typeof input.reviewerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.reviewerId)
    || !['APPROVE','REJECT'].includes(input.decision) || typeof input.evidenceReference !== 'string'
    || !input.evidenceReference.trim() || input.evidenceReference.length > 255
    || !Number.isSafeInteger(now) || now <= 0) fail('REFUND_REVIEW_INPUT_INVALID');
  const [[binding]] = await pool.execute('SELECT order_id,payment_id FROM order_refunds WHERE id=?', [input.refundId]);
  if (!binding) fail('REFUND_NOT_FOUND');
  return inTransaction(pool, async connection => {
    const [[order]] = await connection.execute('SELECT id FROM order_aggregates WHERE id=? FOR UPDATE', [binding.order_id]);
    const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id=? FOR UPDATE', [binding.payment_id]);
    const [rows] = await connection.execute('SELECT * FROM order_refunds WHERE order_id=? ORDER BY id FOR UPDATE', [binding.order_id]);
    const refund = rows.find(row => row.id === input.refundId);
    if (!order || !payment || !refund || payment.order_id !== order.id || refund.payment_id !== payment.id) fail('REFUND_NOT_FOUND');
    if (refund.review_decision) {
      if (refund.review_decision !== input.decision || refund.reviewed_by !== input.reviewerId
        || refund.evidence_reference !== input.evidenceReference) fail('REFUND_REVIEW_CONFLICT');
      return refund;
    }
    if (refund.status !== 'REQUESTED' || now < Number(refund.updated_at)) fail('REFUND_STATE_CHANGED');
    const [[hold]] = await connection.execute('SELECT * FROM order_funds_interlocks WHERE order_id=? FOR UPDATE', [order.id]);
    if (input.decision === 'APPROVE') {
      if (refund.settlement_review_required || hold?.settlement_task_id) fail('REFUND_SETTLEMENT_REVIEW_REQUIRED');
      if (hold?.hold_reason === 'DISPUTE') fail('REFUND_DISPUTE_REVIEW_REQUIRED');
      if (hold?.hold_reason !== 'REFUND_REQUEST') fail('REFUND_HOLD_MISSING');
      if (payment.status !== 'PAID' || payment.payer_verification !== 'MATCHED' || payment.payment_mode !== 'DIRECT'
        || payment.platform_mchid !== refund.platform_mchid || payment.transaction_id !== refund.transaction_id
        || Number(payment.amount_fen) !== Number(refund.total_fen) || payment.fee_rule_version !== VERSION
        || refund.fee_rule_version !== VERSION || Number(payment.platform_fee_fen) !== Number(refund.platform_fee_fen)
        || Number(refund.platform_fee_fen) !== platformFee(Number(refund.total_fen)).amountFen) fail('REFUND_PAYMENT_NOT_READY');
      const reserved = rows.filter(row => row.payment_id === payment.id && !['REJECTED','CLOSED'].includes(row.status))
        .reduce((sum, row) => sum + BigInt(row.amount_fen), 0n);
      if (reserved > BigInt(payment.amount_fen)) fail('REFUND_AMOUNT_EXCEEDED');
    }
    await connection.execute(`UPDATE order_refunds SET status=?,review_decision=?,reviewed_by=?,evidence_reference=?,reviewed_at=?,updated_at=?
      WHERE id=? AND status='REQUESTED'`, [input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', input.decision,
      input.reviewerId, input.evidenceReference, now, now, refund.id]);
    if (input.decision === 'REJECT' && !rows.some(row => row.id !== refund.id && !['REJECTED','CLOSED'].includes(row.status))) {
      // Never release a dispute, another refund's hold, or a fenced settlement.
      await connection.execute(`UPDATE order_funds_interlocks SET hold_reason=NULL,held_at=NULL
        WHERE order_id=? AND hold_reason='REFUND_REQUEST' AND settlement_task_id IS NULL`, [order.id]);
    }
    const [[updated]] = await connection.execute('SELECT * FROM order_refunds WHERE id=?', [refund.id]);
    return updated;
  });
}
module.exports = { requestRefund, reviewRefund };
