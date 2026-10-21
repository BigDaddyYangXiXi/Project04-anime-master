const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const { VERSION, platformFee } = require('./fee-policy');
const { submitRefund } = require('./wechat-refund');
const { MUTATION_BUDGET_MS } = require('./payment-timeouts');
const LEASE_MS = 30000;
function fail(code) { const error = new Error(code); error.code = code; throw error; }

async function claimRefund(pool, id, config, now = Date.now()) {
  if (config?.refundEnabled !== true) return { status: 'DISABLED' };
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || !Number.isSafeInteger(now)
    || now <= 0 || !Number.isSafeInteger(now + LEASE_MS)) fail('REFUND_INPUT_INVALID');
  const [[binding]] = await pool.execute('SELECT order_id,payment_id FROM order_refunds WHERE id=?', [id]);
  if (!binding) fail('REFUND_NOT_FOUND');
  return inTransaction(pool, async connection => {
    const [[order]] = await connection.execute('SELECT id FROM order_aggregates WHERE id=? FOR UPDATE', [binding.order_id]);
    const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id=? FOR UPDATE', [binding.payment_id]);
    const [rows] = await connection.execute('SELECT * FROM order_refunds WHERE order_id=? ORDER BY id FOR UPDATE', [binding.order_id]);
    const refund = rows.find(row => row.id === id);
    if (!order || !payment || !refund || refund.payment_id !== payment.id || payment.order_id !== order.id) fail('REFUND_NOT_FOUND');
    if (refund.submission_started_at != null) return { status: refund.status === 'SUBMITTING'
      && Number(refund.submission_lease_until) > now ? 'BUSY' : 'QUERY_REQUIRED' };
    if (refund.status !== 'APPROVED' || refund.review_decision !== 'APPROVE' || now < Number(refund.updated_at)) fail('REFUND_NOT_APPROVED');
    const [[hold]] = await connection.execute('SELECT * FROM order_funds_interlocks WHERE order_id=? FOR UPDATE', [order.id]);
    if (hold?.hold_reason !== 'REFUND_REQUEST' || hold.settlement_task_id || refund.settlement_review_required) return { status: 'DEFERRED' };
    if (payment.status !== 'PAID' || payment.payer_verification !== 'MATCHED' || payment.payment_mode !== 'DIRECT'
      || payment.platform_mchid !== config.platformMchid || refund.platform_mchid !== config.platformMchid || payment.appid !== config.appid
      || refund.transaction_id !== payment.transaction_id || Number(refund.total_fen) !== Number(payment.amount_fen)
      || refund.fee_rule_version !== VERSION || payment.fee_rule_version !== VERSION
      || Number(refund.platform_fee_fen) !== Number(payment.platform_fee_fen)
      || Number(refund.platform_fee_fen) !== platformFee(Number(refund.total_fen)).amountFen) fail('REFUND_PAYMENT_NOT_READY');
    const samePayment = rows.filter(row => row.payment_id === payment.id);
    if (samePayment.filter(row => !['REJECTED','CLOSED'].includes(row.status)).reduce((sum, row) => sum + BigInt(row.amount_fen), 0n)
      > BigInt(payment.amount_fen)) fail('REFUND_AMOUNT_EXCEEDED');
    // An unresolved refund must be reconciled before another refund can be submitted for this payment.
    if (samePayment.some(row => row.id !== id && (['SUBMITTING','PROCESSING','ABNORMAL'].includes(row.status)
      || row.submission_started_at != null && now - Number(row.submission_started_at) < 60000))) return { status: 'DEFERRED' };
    const token = crypto.randomBytes(16).toString('hex');
    await connection.execute(`UPDATE order_refunds SET status='SUBMITTING',submission_started_at=?,submission_lease_token=?,submission_lease_until=?,updated_at=?
      WHERE id=? AND status='APPROVED'`, [now, token, now + LEASE_MS, now, id]);
    // Approved snapshot for the adapter; the database has already durably fenced this submission.
    return { status: 'CLAIMED', token, leaseUntil: now + LEASE_MS,
      refund: { ...refund, amount_fen: Number(refund.amount_fen), total_fen: Number(refund.total_fen) } };
  });
}
async function executeRefund(pool, id, config, channel = submitRefund, clock = Date.now) {
  const claim = await claimRefund(pool, id, config, clock());
  if (claim.status !== 'CLAIMED') return claim;
  if (clock() + MUTATION_BUDGET_MS >= claim.leaseUntil) return { status: 'QUERY_REQUIRED' };
  // Do not clear the fence on timeout, bad response or process failure. Recovery queries the same refund ID.
  const receipt = await channel(claim.refund, config, undefined, clock);
  if (receipt?.refundId !== id || receipt.status !== 'PROCESSING' || !/^[A-Za-z0-9_-]{1,64}$/.test(receipt.channelRefundId || '')) fail('REFUND_RESPONSE_INVALID');
  const now = clock();
  if (!Number.isSafeInteger(now) || now <= 0) fail('REFUND_INPUT_INVALID');
  const [result] = await pool.execute(`UPDATE order_refunds SET status='PROCESSING',channel_refund_id=?,
    submission_lease_token=NULL,submission_lease_until=NULL,updated_at=GREATEST(updated_at,?)
    WHERE id=? AND status='SUBMITTING' AND submission_lease_token=?`, [receipt.channelRefundId, now, id, claim.token]);
  if (result.affectedRows !== 1) fail('REFUND_STATE_CHANGED');
  return { status: 'PROCESSING', refundId: id };
}
module.exports = { claimRefund, executeRefund, LEASE_MS };
