const { inTransaction } = require('./payment-store');
const { refundAllocation } = require('./fee-policy');
const { queryRefund } = require('./wechat-refund');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Only accepts receipts already bound and verified by the channel adapter, never raw client input.
async function recordRefundResult(pool, receipt, now = Date.now()) {
  if (!receipt || !/^[a-f0-9]{32}$/.test(receipt.refundId || '')
    || !/^[A-Za-z0-9_-]{1,64}$/.test(receipt.channelRefundId || '')
    || !['PROCESSING','SUCCESS','CLOSED','ABNORMAL'].includes(receipt.status)
    || !Number.isSafeInteger(receipt.amountFen) || receipt.amountFen <= 0 || !Number.isSafeInteger(now) || now <= 0
    || (receipt.status === 'SUCCESS' ? !Number.isSafeInteger(receipt.succeededAt) || receipt.succeededAt <= 0
      || receipt.succeededAt > now + 300000 : receipt.succeededAt != null)) fail('REFUND_RESULT_INVALID');
  const [[binding]] = await pool.execute('SELECT order_id,payment_id FROM order_refunds WHERE id=?', [receipt.refundId]);
  if (!binding) fail('REFUND_NOT_FOUND');
  return inTransaction(pool, async connection => {
    const [[order]] = await connection.execute('SELECT id,provider_id FROM order_aggregates WHERE id=? FOR UPDATE', [binding.order_id]);
    const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id=? FOR UPDATE', [binding.payment_id]);
    const [rows] = await connection.execute('SELECT * FROM order_refunds WHERE order_id=? ORDER BY id FOR UPDATE', [binding.order_id]);
    const refund = rows.find(row => row.id === receipt.refundId);
    if (!order || !payment || !refund || refund.payment_id !== payment.id || payment.order_id !== order.id) fail('REFUND_NOT_FOUND');
    if (refund.review_decision !== 'APPROVE' || refund.submission_started_at == null
      || !['SUBMITTING','PROCESSING','ABNORMAL','SUCCESS','CLOSED'].includes(refund.status)
      || Number(refund.amount_fen) !== receipt.amountFen || refund.channel_refund_id && refund.channel_refund_id !== receipt.channelRefundId
      || refund.transaction_id !== payment.transaction_id || refund.platform_mchid !== payment.platform_mchid
      || Number(refund.total_fen) !== Number(payment.amount_fen) || refund.fee_rule_version !== payment.fee_rule_version
      || Number(refund.platform_fee_fen) !== Number(payment.platform_fee_fen)) fail('REFUND_RESULT_MISMATCH');
    if (['SUCCESS','CLOSED'].includes(refund.status)) {
      if (['SUCCESS','CLOSED'].includes(receipt.status) && receipt.status !== refund.status) fail('REFUND_RESULT_CONFLICT');
      if (refund.status === 'SUCCESS') {
        if (receipt.status === 'SUCCESS' && Number(refund.succeeded_at) !== receipt.succeededAt) fail('REFUND_RESULT_CONFLICT');
        const [[reversal]] = await connection.execute('SELECT refund_fen FROM order_refund_reversals WHERE refund_id=?', [refund.id]);
        if (!reversal || Number(reversal.refund_fen) !== receipt.amountFen) fail('REFUND_REVERSAL_MISSING');
      }
      return refund;
    }
    if (refund.status === 'ABNORMAL' && receipt.status === 'PROCESSING') return refund;
    if (receipt.status === 'SUCCESS') {
      const previous = rows.filter(row => row.payment_id === payment.id && row.status === 'SUCCESS')
        .reduce((sum, row) => sum + BigInt(row.amount_fen), 0n);
      if (previous > BigInt(Number.MAX_SAFE_INTEGER)) fail('REFUND_AMOUNT_EXCEEDED');
      const allocation = refundAllocation({ totalFen: Number(payment.amount_fen), platformFeeFen: Number(payment.platform_fee_fen),
        feeRuleVersion: payment.fee_rule_version, previouslyRefundedFen: Number(previous), refundFen: receipt.amountFen });
      await require('./fund-ledger').postFunds(connection, payment, order.provider_id, refund, allocation, now);
      await connection.execute(`INSERT INTO order_refund_reversals
        (refund_id,payment_id,refund_fen,cumulative_refund_fen,platform_reversal_fen,provider_reversal_fen,created_at) VALUES(?,?,?,?,?,?,?)`,
      [refund.id, payment.id, receipt.amountFen, allocation.cumulativeRefundFen, allocation.platformReversalFen, allocation.providerReversalFen, now]);
      await connection.execute(`UPDATE order_payments SET refunded_fen=?,platform_refunded_fen=?,provider_refunded_fen=? WHERE id=?`,
      [allocation.cumulativeRefundFen, Number(payment.platform_fee_fen) - allocation.retainedPlatformFen,
        Number(payment.amount_fen) - Number(payment.platform_fee_fen) - allocation.retainedProviderFen, payment.id]);
    }
    await connection.execute(`UPDATE order_refunds SET status=?,channel_refund_id=?,succeeded_at=?,
      submission_lease_token=NULL,submission_lease_until=NULL,updated_at=GREATEST(updated_at,?) WHERE id=?`,
    [receipt.status, receipt.channelRefundId, receipt.status === 'SUCCESS' ? receipt.succeededAt : null, now, refund.id]);
    if (receipt.status === 'CLOSED' && !rows.some(row => row.id !== refund.id && !['REJECTED','CLOSED'].includes(row.status))) {
      await connection.execute(`UPDATE order_funds_interlocks SET hold_reason=NULL,held_at=NULL
        WHERE order_id=? AND hold_reason='REFUND_REQUEST' AND settlement_task_id IS NULL`, [order.id]);
    }
    // Successful refund holds remain until the order and income ledger account for the reduced principal.
    const [[stored]] = await connection.execute('SELECT * FROM order_refunds WHERE id=?', [refund.id]);
    return stored;
  });
}
async function refreshRefund(pool, id, config, channel = queryRefund, clock = Date.now) {
  if (config?.refundReconciliationEnabled !== true) return { status: 'DISABLED' };
  if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) fail('REFUND_INPUT_INVALID');
  const [[refund]] = await pool.execute('SELECT * FROM order_refunds WHERE id=?', [id]);
  if (!refund || refund.platform_mchid !== config.platformMchid) fail('REFUND_NOT_FOUND');
  if (refund.submission_started_at == null) return { status: 'NOT_SUBMITTED' };
  if (refund.status === 'SUBMITTING' && Number(refund.submission_lease_until) > clock()) return { status: 'BUSY' };
  const receipt = await channel({ ...refund, amount_fen: Number(refund.amount_fen), total_fen: Number(refund.total_fen) }, config, undefined, clock);
  if (receipt?.refundId !== id) fail('REFUND_RESULT_MISMATCH');
  const stored = await recordRefundResult(pool, receipt, clock());
  return { refundId: id, status: stored.status };
}
module.exports = { recordRefundResult, refreshRefund };
