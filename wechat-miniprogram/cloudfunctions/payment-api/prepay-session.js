const { MUTATION_BUDGET_MS } = require('./payment-timeouts');
const crypto = require('node:crypto');
const { inTransaction, agreementHash, agreementReady } = require('./payment-store');
const { buildPrepayRequest, createPrepay, paymentArguments } = require('./wechat-prepay');
const LEASE_MS = 30000;
const SUBMIT_BUDGET_MS = MUTATION_BUDGET_MS;
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Match the receipt/reservation lock order: order -> payment -> merchant.
async function lockEligiblePayment(connection, paymentId, orderId) {
  const [[order]] = await connection.execute('SELECT * FROM order_aggregates WHERE id = ? FOR UPDATE', [orderId]);
  const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id = ? FOR UPDATE', [paymentId]);
  if (!order || !payment || payment.order_id !== order.id) fail('PAYMENT_NOT_FOUND');
  const payload = typeof order.payload === 'string' ? JSON.parse(order.payload) : order.payload;
  if (!['UNPAID', 'FAILED'].includes(payload.public.paymentStatus)) fail('PAYMENT_STATE_CHANGED');
  if (payment.status !== 'CREATED' || !agreementReady(order) || agreementHash(order) !== payment.agreement_hash) fail('PAYMENT_STATE_CHANGED');
  if (payment.payment_mode === 'DIRECT') {
    if (payment.sub_mchid !== null) fail('PAYMENT_IDENTITY_MISMATCH');
    return payment;
  }
  const [[merchant]] = await connection.execute('SELECT * FROM provider_payment_merchants WHERE provider_id = ? FOR SHARE', [order.provider_id]);
  if (!merchant || merchant.status !== 'READY' || !(Number(merchant.verified_at) > 0)
    || merchant.platform_mchid !== payment.platform_mchid || merchant.sub_mchid !== payment.sub_mchid) fail('PAYMENT_MERCHANT_NOT_READY');
  return payment;
}

// Internal only: caller identity, fee policy and agreement must be checked before reservePayment.
async function preparePaymentSession(pool, paymentId, config, channel = createPrepay, clock = Date.now) {
  const now = clock();
  if (!/^[a-f0-9]{32}$/.test(paymentId || '') || !Number.isSafeInteger(now) || now <= 0
    || !Number.isSafeInteger(now + LEASE_MS)) fail('PAYMENT_INPUT_INVALID');
  const [[binding]] = await pool.execute('SELECT order_id FROM order_payments WHERE id = ?', [paymentId]);
  if (!binding) fail('PAYMENT_NOT_FOUND');
  const claim = await inTransaction(pool, async connection => {
    const payment = await lockEligiblePayment(connection, paymentId, binding.order_id);
    buildPrepayRequest(payment, config, now);
    if (Number(payment.prepay_recovery_started_at) > 0) return { status: 'QUERY_REQUIRED' };
    if (payment.prepay_id) return Number(payment.prepay_started_at) > 0
      && now < Number(payment.prepay_started_at) + 2 * 60 * 60 * 1000
      ? { status: 'READY', payment } : { status: 'QUERY_REQUIRED' };
    if (Number(payment.prepay_lease_until) > now) return { status: 'BUSY' };
    // A timeout/crash can occur after WeChat has created the order. Never submit a replacement here.
    if (Number(payment.prepay_started_at) > 0) return { status: 'QUERY_REQUIRED' };
    const token = crypto.randomBytes(16).toString('hex');
    await connection.execute(`UPDATE order_payments SET prepay_started_at=?, prepay_lease_until=?,
      prepay_lease_token=? WHERE id=?`, [now, now + LEASE_MS, token, paymentId]);
    return { status: 'CLAIMED', payment, token };
  });
  if (claim.status === 'READY') return { status: 'READY', paymentRequest: paymentArguments(claim.payment.prepay_id, config, now) };
  if (claim.status !== 'CLAIMED') return claim;
  try {
    const [[ownership]] = await pool.execute('SELECT status,prepay_lease_token,prepay_lease_until FROM order_payments WHERE id=?', [paymentId]);
    const beforeSubmit = clock();
    if (!ownership || ownership.status !== 'CREATED' || ownership.prepay_lease_token !== claim.token) return { status: 'QUERY_REQUIRED' };
    if (!Number.isSafeInteger(beforeSubmit) || beforeSubmit < now
      || Number(ownership.prepay_lease_until) - beforeSubmit <= SUBMIT_BUDGET_MS) {
      // No channel invocation has occurred. Release only this undispatched attempt, never a successor or recovery.
      const [cleared] = await pool.execute(`UPDATE order_payments SET prepay_started_at=0,prepay_lease_until=0,prepay_lease_token=NULL
        WHERE id=? AND prepay_lease_token=? AND status='CREATED' AND prepay_id IS NULL AND prepay_recovery_started_at=0`,
      [paymentId, claim.token]);
      return { status: cleared.affectedRows === 1 ? 'BUSY' : 'QUERY_REQUIRED' };
    }
    const result = await channel(claim.payment, config, undefined, clock);
    const [saved] = await pool.execute(`UPDATE order_payments SET prepay_id=?, prepay_lease_until=0,
      prepay_lease_token=NULL WHERE id=? AND prepay_lease_token=? AND status='CREATED'`,
    [result.prepayId, paymentId, claim.token]);
    if (saved.affectedRows !== 1) fail('PAYMENT_STATE_CHANGED');
    // Keep the known channel id even if eligibility changed while the HTTP request was in flight.
    await inTransaction(pool, connection => lockEligiblePayment(connection, paymentId, binding.order_id));
    return { status: 'READY', paymentRequest: result.paymentRequest };
  } finally {
    // Do not replace a channel/commit error with a lease-release error. Expiry is the recovery fallback.
    try {
      await pool.execute('UPDATE order_payments SET prepay_lease_until=0, prepay_lease_token=NULL WHERE id=? AND prepay_lease_token=?',
        [paymentId, claim.token]);
    } catch (_) { /* no retry and no upstream details in logs */ }
  }
}

module.exports = { preparePaymentSession, LEASE_MS };
