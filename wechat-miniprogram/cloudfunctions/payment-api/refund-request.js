const { requestRefund } = require('./refund-store');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// RPC only creates a review request. It cannot approve, submit or assert a channel result.
async function createRefundRequest(pool, event, caller, config, clock = Date.now) {
  const openid = caller && (caller.WX_OPENID || caller.OPENID), appid = caller && (caller.WX_APPID || caller.APPID);
  if (typeof openid !== 'string' || !openid || typeof appid !== 'string' || !appid || appid !== config?.appid) fail('AUTH_CONTEXT_MISSING');
  if (!event || event.action !== 'requestRefund'
    || Object.keys(event).some(key => !['action','orderId','paymentId','requestKey','amountFen','reason'].includes(key))
    || typeof event.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(event.orderId)
    || typeof event.paymentId !== 'string' || !/^[a-f0-9]{32}$/.test(event.paymentId)
    || typeof event.requestKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(event.requestKey)
    || !Number.isSafeInteger(event.amountFen) || event.amountFen <= 0
    || typeof event.reason !== 'string' || !event.reason.trim() || Buffer.byteLength(event.reason) > 80) fail('REFUND_INPUT_INVALID');
  if (config.refundRequestsEnabled !== true) fail('REFUND_REQUEST_NOT_ENABLED');
  const [[account]] = await pool.execute(`SELECT a.id,w.open_id FROM accounts a
    JOIN wechat_identities w ON w.account_id=a.id JOIN account_roles r ON r.account_id=a.id AND r.role='BUYER'
    WHERE w.open_id=? AND a.status='ACTIVE'`, [openid]);
  if (!account || account.open_id !== openid) fail('ACCOUNT_NOT_FOUND');
  const [[payment]] = await pool.execute(`SELECT p.appid,p.payer_openid FROM order_payments p
    JOIN order_aggregates o ON o.id=p.order_id WHERE p.id=? AND p.order_id=? AND o.buyer_id=?`,
  [event.paymentId, event.orderId, account.id]);
  if (!payment || payment.appid !== appid || payment.payer_openid !== openid) fail('ORDER_NOT_FOUND');
  const row = await requestRefund(pool, { orderId: event.orderId, paymentId: event.paymentId, buyerId: account.id,
    requestKey: event.requestKey, amountFen: event.amountFen, reason: event.reason }, config.platformMchid, clock());
  return { refundId: row.id, orderId: row.order_id, amountFen: Number(row.amount_fen), status: row.status,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
module.exports = { createRefundRequest };
