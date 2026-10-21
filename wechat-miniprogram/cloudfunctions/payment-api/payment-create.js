const { reservePayment } = require('./payment-store');
const { preparePaymentSession } = require('./prepay-session');
const { VERSION } = require('./fee-policy');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Server configuration keeps prepayment closed pending product and transaction prerequisites.
async function createPayment(pool, event, caller, config, prepare = preparePaymentSession, clock = Date.now) {
  const openid = caller && (caller.WX_OPENID || caller.OPENID);
  const appid = caller && (caller.WX_APPID || caller.APPID);
  if (typeof openid !== 'string' || !openid || typeof appid !== 'string' || !appid
    || !config || appid !== config.appid) fail('AUTH_CONTEXT_MISSING');
  if (!event || event.action !== 'createPayment' || typeof event.orderId !== 'string'
    || !/^[A-Za-z0-9_-]{1,64}$/.test(event.orderId)
    || typeof event.requestKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(event.requestKey)
    || !Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 1
    || Object.keys(event).some(key => !['action', 'orderId', 'requestKey', 'expectedVersion'].includes(key))) fail('PAYMENT_INPUT_INVALID');
  if (config.prepayEnabled !== true) fail('PAYMENT_PREPAY_NOT_ENABLED');
  const now = clock();
  if (!Number.isSafeInteger(now) || now <= 0) fail('PAYMENT_INPUT_INVALID');
  const [[account]] = await pool.execute(`SELECT a.id, w.open_id FROM accounts a
    JOIN wechat_identities w ON w.account_id = a.id
    JOIN account_roles r ON r.account_id = a.id AND r.role = 'BUYER'
    WHERE w.open_id = ? AND a.status = 'ACTIVE'`, [openid]);
  if (!account || account.open_id !== openid) fail('ACCOUNT_NOT_FOUND');
  const payment = await reservePayment(pool, {
    orderId: event.orderId, buyerId: account.id, requestKey: event.requestKey,
    expectedVersion: event.expectedVersion, payerOpenid: openid, appid,
    platformMchid: config.platformMchid, paymentMode: config.paymentMode || 'COMBINE', feeRuleVersion: VERSION
  }, now);
  if (payment.status !== 'CREATED') return { status: payment.status };
  const prepared = await prepare(pool, payment.id, config, undefined, clock);
  // Never expose stored payment identity, merchant credentials or internal snapshots.
  if (prepared.status === 'READY') return { status: 'READY', paymentRequest: prepared.paymentRequest };
  if (['BUSY', 'QUERY_REQUIRED'].includes(prepared.status)) return { status: prepared.status };
  fail('PAYMENT_STATE_CHANGED');
}

module.exports = { createPayment };
