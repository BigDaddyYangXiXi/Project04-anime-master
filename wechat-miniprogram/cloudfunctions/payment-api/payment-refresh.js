const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const { queryPayment } = require('./wechat-query');
const COOLDOWN_MS = 15000;
const LEASE_MS = 30000;
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function identity(caller) {
  const openid = caller && (caller.WX_OPENID || caller.OPENID);
  const appid = caller && (caller.WX_APPID || caller.APPID);
  if (typeof openid !== 'string' || !openid || typeof appid !== 'string' || !appid) fail('AUTH_CONTEXT_MISSING');
  return { openid, appid };
}
async function claim(pool, orderId, actor, now) {
  return inTransaction(pool, async connection => {
    const [[account]] = await connection.execute(`SELECT a.id, w.open_id FROM accounts a
      JOIN wechat_identities w ON w.account_id = a.id
      JOIN account_roles r ON r.account_id = a.id AND r.role = 'BUYER'
      WHERE w.open_id = ? AND a.status = 'ACTIVE'`, [actor.openid]);
    if (!account || account.open_id !== actor.openid) fail('ACCOUNT_NOT_FOUND');
    const [[order]] = await connection.execute('SELECT id,buyer_id FROM order_aggregates WHERE id = ? FOR UPDATE', [orderId]);
    if (!order || order.buyer_id !== account.id) fail('ORDER_NOT_FOUND');
    const [payments] = await connection.execute('SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at DESC, id DESC FOR UPDATE', [orderId]);
    if (payments.some(payment => ['PAID','PAID_REQUIRES_REVIEW'].includes(payment.status))) return { queryStatus:'FINAL' };
    const payment = payments.find(item => item.status === 'CREATED');
    if (!payment) return { queryStatus:'NOT_STARTED' };
    if (payment.appid !== actor.appid || payment.payer_openid !== actor.openid) fail('PAYMENT_IDENTITY_MISMATCH');
    const next = Math.max(Number(payment.query_started_at) + COOLDOWN_MS, Number(payment.query_lease_until));
    if (next > now) return { queryStatus:'THROTTLED', retryAfterSeconds:Math.ceil((next - now) / 1000) };
    const lease = crypto.randomBytes(16).toString('hex');
    await connection.execute('UPDATE order_payments SET query_started_at = ?, query_lease_until = ?, query_lease_token = ? WHERE id = ?', [now, now + LEASE_MS, lease, payment.id]);
    return { paymentId:payment.id, lease };
  });
}
async function refreshPayment(pool, event, caller, config, query = queryPayment, clock = Date.now) {
  if (!event || event.action !== 'refreshPayment' || typeof event.orderId !== 'string'
    || !/^[A-Za-z0-9_-]{1,64}$/.test(event.orderId)
    || Object.keys(event).some(key => !['action','orderId'].includes(key))) fail('PAYMENT_INPUT_INVALID');
  const actor = identity(caller);
  const now = clock();
  if (!Number.isSafeInteger(now) || now <= 0) fail('PAYMENT_INPUT_INVALID');
  const lease = await claim(pool, event.orderId, actor, now);
  if (!lease.paymentId) return lease;
  try {
    await query(pool, lease.paymentId, config, undefined, clock);
    return { queryStatus:'QUERIED' };
  } finally {
    // Only this lease may be released; an expired request must not release its successor.
    await pool.execute('UPDATE order_payments SET query_lease_until = 0, query_lease_token = NULL WHERE id = ? AND query_lease_token = ?', [lease.paymentId, lease.lease]);
  }
}
module.exports = { refreshPayment, COOLDOWN_MS, LEASE_MS };
