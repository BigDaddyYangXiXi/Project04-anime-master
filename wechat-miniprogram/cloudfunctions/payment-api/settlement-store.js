const { MUTATION_BUDGET_MS } = require('./payment-timeouts');
const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const LEASE_MS = 30000;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function object(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
function validateInput(orderId, now) {
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)
    || !Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(now + LEASE_MS)) fail('SETTLEMENT_INPUT_INVALID');
}

// Internal preparation only. No public handler or channel request is enabled here.
// Lock order matches payment persistence: order, payment, merchant, then settlement task.
async function prepareLocked(connection, orderId, now) {
  const [[order]] = await connection.execute('SELECT * FROM order_aggregates WHERE id = ? FOR UPDATE', [orderId]);
  if (!order) fail('ORDER_NOT_FOUND');
  const payload = object(order.payload), p = payload.public, intent = payload.settlementIntent;
  if (order.stage !== 'COMPLETED' || !intent || intent.status !== 'PENDING'
    || !Number.isSafeInteger(intent.acceptedOrderVersion) || intent.acceptedOrderVersion > Number(order.version)
    || intent.createdAt !== p.completedAt || !(intent.createdAt > 0)) fail('SETTLEMENT_NOT_ACCEPTED');
  if (p.paymentStatus !== 'PAID' || intent.paymentId !== p.paymentId) fail('PAYMENT_NOT_VERIFIED');
  const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id = ? FOR UPDATE', [intent.paymentId]);
  if (payment?.payment_mode === 'DIRECT') fail('DIRECT_SETTLEMENT_NOT_ENABLED');
  if (!payment || payment.order_id !== order.id || payment.status !== 'PAID'
    || payment.payer_verification !== 'MATCHED' || !payment.transaction_id
    || payment.transaction_id !== p.paymentTransactionId || payment.currency !== 'CNY'
    || payment.received_currency !== 'CNY' || Number(payment.received_total_fen) !== Number(payment.amount_fen)
    || Number(payment.amount_fen) !== p.amountFen) fail('PAYMENT_NOT_VERIFIED');
  const totalFen = Number(payment.amount_fen), platformFeeFen = Number(payment.platform_fee_fen);
  if (!Number.isSafeInteger(totalFen) || totalFen <= 0 || !Number.isSafeInteger(platformFeeFen)
    || platformFeeFen <= 0 || platformFeeFen > totalFen || !payment.fee_rule_version) fail('PAYMENT_FEE_NOT_CONFIGURED');
  const [[merchant]] = await connection.execute('SELECT * FROM provider_payment_merchants WHERE provider_id = ? FOR SHARE', [order.provider_id]);
  if (!merchant || merchant.status !== 'READY' || !(Number(merchant.verified_at) > 0)
    || merchant.platform_mchid !== payment.platform_mchid || merchant.sub_mchid !== payment.sub_mchid) fail('PAYMENT_MERCHANT_NOT_READY');
  const snapshot = { orderId: order.id, paymentId: payment.id, providerId: order.provider_id,
    transactionId: payment.transaction_id, appid: payment.appid, platformMchid: payment.platform_mchid,
    subMchid: payment.sub_mchid, totalFen, platformFeeFen, feeRuleVersion: payment.fee_rule_version,
    acceptedOrderVersion: intent.acceptedOrderVersion, acceptedAt: intent.createdAt };
  const [[existing]] = await connection.execute('SELECT * FROM order_settlement_tasks WHERE order_id = ? FOR UPDATE', [orderId]);
  if (existing) {
    const stored = object(existing.request_snapshot);
    if (existing.payment_id !== payment.id || Object.keys(snapshot).some(key => snapshot[key] !== stored[key])) fail('SETTLEMENT_SNAPSHOT_CONFLICT');
    return existing;
  }
  const id = crypto.randomBytes(16).toString('hex');
  await connection.execute(`INSERT INTO order_settlement_tasks
    (id,order_id,payment_id,request_snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
  [id, orderId, payment.id, JSON.stringify(snapshot), now, now]);
  const [[task]] = await connection.execute('SELECT * FROM order_settlement_tasks WHERE id = ?', [id]);
  return task;
}

async function prepareSettlement(pool, orderId, now = Date.now()) {
  validateInput(orderId, now);
  return inTransaction(pool, connection => prepareLocked(connection, orderId, now));
}

async function claimSettlement(pool, orderId, now = Date.now()) {
  validateInput(orderId, now);
  return inTransaction(pool, async connection => {
    // Recovery only queries an already submitted immutable request. Changed merchant/order
    // eligibility must block new submissions, not observation of money already in flight.
    await connection.execute('SELECT id FROM order_aggregates WHERE id = ? FOR UPDATE', [orderId]);
    const [[existing]] = await connection.execute('SELECT * FROM order_settlement_tasks WHERE order_id = ? FOR UPDATE', [orderId]);
    const task = existing && Number(existing.attempts) > 0 ? existing : await prepareLocked(connection, orderId, now);
    if (['FEE_SUCCEEDED', 'CLOSED'].includes(task.status)) return { status: 'FINAL', taskId: task.id, result: task.status };
    if (Number(task.lease_until) > now) return { status: 'BUSY', retryAt: Number(task.lease_until) };
    const leaseToken = crypto.randomBytes(16).toString('hex');
    await connection.execute(`UPDATE order_settlement_tasks SET status = 'PROCESSING', attempts = attempts + 1,
      lease_token = ?, lease_until = ?, updated_at = ? WHERE id = ?`, [leaseToken, now + LEASE_MS, now, task.id]);
    // After any previous claim the external outcome may be unknown: query the SAME request id first.
    return { status: 'CLAIMED', taskId: task.id, leaseToken,
      nextAction: Number(task.attempts) === 0 ? 'SUBMIT' : 'QUERY', snapshot: object(task.request_snapshot) };
  });
}

async function releaseSettlement(pool, taskId, leaseToken) {
  if (![taskId, leaseToken].every(value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value))) fail('SETTLEMENT_INPUT_INVALID');
  const [result] = await pool.execute('UPDATE order_settlement_tasks SET lease_token = NULL, lease_until = 0 WHERE id = ? AND lease_token = ?', [taskId, leaseToken]);
  return result.affectedRows === 1;
}

// Only the first claimant that has NOT called the channel may undo its submission marker.
async function releaseUnsubmittedSettlement(pool, taskId, leaseToken) {
  if (![taskId, leaseToken].every(value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value))) fail('SETTLEMENT_INPUT_INVALID');
  const [result] = await pool.execute(`UPDATE order_settlement_tasks SET status='PREPARED', attempts=0,
    lease_token=NULL, lease_until=0 WHERE id=? AND lease_token=? AND status='PROCESSING'
    AND attempts=1 AND channel_order_id IS NULL`, [taskId, leaseToken]);
  return result.affectedRows === 1;
}

async function authorizeSettlementSubmission(pool, orderId, taskId, leaseToken, clock = Date.now) {
  const startedAt = clock();
  validateInput(orderId, startedAt);
  if (![taskId, leaseToken].every(value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value))) fail('SETTLEMENT_INPUT_INVALID');
  return inTransaction(pool, async connection => {
    const task = await prepareLocked(connection, orderId, clock());
    const now = clock();
    if (!Number.isSafeInteger(now) || now < startedAt || task.id !== taskId || task.status !== 'PROCESSING'
      || Number(task.attempts) !== 1 || task.lease_token !== leaseToken || Number(task.lease_until) - now <= MUTATION_BUDGET_MS) return false;
    return require('./funds-interlock').fenceSettlement(connection, orderId, taskId, now);
  });
}

// Internal verified-query sink; never accepts a public client result or a POST acceptance as success.
async function recordSettlementResult(pool, taskId, result, now = Date.now()) {
  if (!/^[a-f0-9]{32}$/.test(taskId || '') || !Number.isSafeInteger(now) || now <= 0
    || !result || !['PROCESSING','FEE_SUCCEEDED','CLOSED'].includes(result.status)
    || typeof result.channelOrderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(result.channelOrderId)) fail('SETTLEMENT_RESULT_INVALID');
  return inTransaction(pool, async connection => {
    const [[task]] = await connection.execute('SELECT * FROM order_settlement_tasks WHERE id = ? FOR UPDATE', [taskId]);
    if (!task) fail('SETTLEMENT_NOT_FOUND');
    if (task.channel_order_id && task.channel_order_id !== result.channelOrderId) fail('SETTLEMENT_RESULT_CONFLICT');
    if (result.status !== 'PROCESSING') {
      const snapshot = object(task.request_snapshot);
      if (result.platformFeeFen !== snapshot.platformFeeFen || !Number.isSafeInteger(result.finishedAt) || result.finishedAt <= 0
        || typeof result.detailId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(result.detailId)
        || result.finishAmountFen !== null && (!Number.isSafeInteger(result.finishAmountFen) || result.finishAmountFen < 0
          || result.finishAmountFen > snapshot.totalFen)) fail('SETTLEMENT_RESULT_INVALID');
    }
    if (['FEE_SUCCEEDED','CLOSED'].includes(task.status)) {
      if (result.status === 'PROCESSING') return { status: task.status };
      const previous = object(task.channel_result);
      if (task.status !== result.status || ['detailId','platformFeeFen','finishedAt','finishAmountFen','failReason']
        .some(key => previous[key] !== result[key])) fail('SETTLEMENT_RESULT_CONFLICT');
      return { status: task.status };
    }
    await connection.execute(`UPDATE order_settlement_tasks SET status=?, channel_order_id=?, channel_result=?,
      verified_at=?, updated_at=? WHERE id=?`,
    [result.status, result.channelOrderId, JSON.stringify(result), now, Math.max(now, Number(task.updated_at)), taskId]);
    return { status: result.status };
  });
}

// A delayed NOT_FOUND must not erase or hide another worker's verified channel result.
async function reconcileSettlementNotFound(pool, taskId) {
  if (typeof taskId !== 'string' || !/^[a-f0-9]{32}$/.test(taskId)) fail('SETTLEMENT_INPUT_INVALID');
  return inTransaction(pool, async connection => {
    const [[task]] = await connection.execute('SELECT * FROM order_settlement_tasks WHERE id=? FOR UPDATE', [taskId]);
    if (!task) fail('SETTLEMENT_NOT_FOUND');
    if (['FEE_SUCCEEDED', 'CLOSED'].includes(task.status)) return { status: task.status };
    if (task.channel_order_id) fail('SETTLEMENT_RESULT_CONFLICT');
    return { status: 'NOT_FOUND' };
  });
}

module.exports = { prepareSettlement, claimSettlement, releaseSettlement, releaseUnsubmittedSettlement, authorizeSettlementSubmission, recordSettlementResult, reconcileSettlementNotFound, LEASE_MS };
