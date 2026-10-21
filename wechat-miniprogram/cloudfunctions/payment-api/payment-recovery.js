const { MUTATION_BUDGET_MS } = require('./payment-timeouts');
const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const { closePrepay } = require('./wechat-close');
const { queryPayment } = require('./wechat-query');
const LEASE_MS = 30000;
// Covers the bounded channel request (8s direct, up to 10s through the planned relay), with margin.
const CLOSE_BUDGET_MS = MUTATION_BUDGET_MS;

// Called only after an authenticated, signed query reported NOTPAY. Never a client action.
async function recoverPrepay(pool, id, config, close = closePrepay, query = queryPayment, clock = Date.now) {
  if (!config || config.closeEnabled !== true) return;
  const now = clock();
  if (!/^[a-f0-9]{32}$/.test(id || '') || !Number.isSafeInteger(now) || now <= 0 || !Number.isSafeInteger(now + LEASE_MS)) {
    const error = new Error('PAYMENT_INPUT_INVALID'); error.code = error.message; throw error;
  }
  const [[binding]] = await pool.execute('SELECT order_id FROM order_payments WHERE id=?', [id]);
  if (!binding) return;
  const claim = await inTransaction(pool, async connection => {
    const [[order]] = await connection.execute('SELECT * FROM order_aggregates WHERE id=? FOR UPDATE', [binding.order_id]);
    const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id=? FOR UPDATE', [id]);
    if (!order || !payment || payment.order_id !== order.id || payment.status !== 'CREATED'
      || payment.appid !== config.appid || payment.platform_mchid !== config.platformMchid) return;
    const started = Number(payment.prepay_started_at);
    if (!(started > 0) || Number(payment.prepay_lease_until) > now) return;
    // A still-usable cashier is not cancelled merely because the buyer refreshed.
    if (!Number(payment.prepay_recovery_started_at) && payment.prepay_id && now < started + 7200000) return;
    const token = crypto.randomBytes(16).toString('hex');
    await connection.execute(`UPDATE order_payments SET prepay_recovery_started_at=?,
      prepay_lease_until=?,prepay_lease_token=? WHERE id=?`, [Number(payment.prepay_recovery_started_at) || now, now + LEASE_MS, token, id]);
    return { payment, token };
  });
  if (!claim) return;
  try {
    // Requery after claiming: a receipt can have arrived since the caller's observation.
    const current = await query(pool, id, config, undefined, clock);
    if (current.status !== 'CREATED' || current.channelStatus !== 'NOTPAY') return current;
    // The preceding query may outlive this worker's lease. Do not close under a successor's authority.
    const [[ownership]] = await pool.execute('SELECT status,prepay_lease_token,prepay_lease_until FROM order_payments WHERE id=?', [id]);
    const beforeClose = clock();
    if (!Number.isSafeInteger(beforeClose) || beforeClose < now || !ownership || ownership.status !== 'CREATED'
      || ownership.prepay_lease_token !== claim.token || Number(ownership.prepay_lease_until) - beforeClose <= CLOSE_BUDGET_MS) return current;
    // Lost close responses and ORDER_CLOSED errors are resolved by a signed query, never guessed.
    try { await close(claim.payment, config, undefined, clock); } catch (_) { /* query the same id below */ }
    return await query(pool, id, config, undefined, clock);
  } finally {
    try {
      await pool.execute('UPDATE order_payments SET prepay_lease_until=0,prepay_lease_token=NULL WHERE id=? AND prepay_lease_token=?', [id, claim.token]);
    } catch (_) { /* preserve the channel error; the lease expires */ }
  }
}

module.exports = { recoverPrepay };
