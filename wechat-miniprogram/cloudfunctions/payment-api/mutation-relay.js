const https = require('node:https');
const { verifyRelayRequest } = require('./relay-auth');
const { requestCombineOrder } = require('./wechat-query');
const { consumeThroughPrivateGuard } = require('./mutation-replay-guard');
function fail() { const error = new Error('PAYMENT_RELAY_REJECTED'); error.code = error.message; throw error; }
const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const merchant = value => typeof value === 'string' && /^\d{1,32}$/.test(value);

// Exact signed bytes only. No retries, id generation, database access or payment-success interpretation here.
// Durable attempt/lease ownership remains in the private caller; unknown outcomes must query the same channel id.
async function relayMutation(event, config, request = https.request, clock = Date.now, consume = consumeThroughPrivateGuard) {
  if (!config || config.enabled !== true || config.mutationsEnabled !== true
    || typeof config.appid !== 'string' || !config.appid || !event
    || Object.keys(event).some(key => !['path', 'body', 'authorization'].includes(key))
    || typeof event.path !== 'string' || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 65536) fail();
  const close = /^\/v3\/combine-transactions\/out-trade-no\/([a-f0-9]{32})\/close$/.exec(event.path);
  const prepay = event.path === '/v3/combine-transactions/jsapi';
  const directPrepay = event.path === '/v3/pay/transactions/jsapi';
  const directClose = /^\/v3\/pay\/transactions\/out-trade-no\/([a-f0-9]{32})\/close$/.exec(event.path);
  const settlement = event.path === '/v3/ecommerce/profitsharing/orders';
  const refund = event.path === '/v3/refund/domestic/refunds';
  if (!close && !prepay && !settlement && !directPrepay && !directClose && !refund) fail();
  verifyRelayRequest('POST', event, event.body, config, clock());
  let body;
  try { body = JSON.parse(event.body); } catch { fail(); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail();
  if (refund) {
    if (config.refundEnabled !== true || !id(body.out_refund_no)
      || typeof body.transaction_id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(body.transaction_id)
      || Object.keys(body).some(key => !['transaction_id','out_refund_no','reason','notify_url','amount'].includes(key))
      || typeof config.refundNotifyUrl !== 'string' || !config.refundNotifyUrl.startsWith('https://') || body.notify_url !== config.refundNotifyUrl
      || typeof body.reason !== 'string' || !body.reason.trim() || Buffer.byteLength(body.reason) > 80
      || !body.amount || typeof body.amount !== 'object' || Array.isArray(body.amount)
      || Object.keys(body.amount).some(key => !['refund','total','currency'].includes(key))
      || !Number.isSafeInteger(body.amount.total) || !Number.isSafeInteger(body.amount.refund)
      || body.amount.refund <= 0 || body.amount.refund > body.amount.total || body.amount.currency !== 'CNY') fail();
  } else if (directPrepay || directClose) {
    if (body.mchid !== config.platformMchid) fail();
    const allowed = directPrepay ? ['appid', 'mchid', 'out_trade_no', 'description', 'notify_url', 'amount', 'payer'] : ['mchid'];
    if (Object.keys(body).some(key => !allowed.includes(key))) fail();
    if (directPrepay && (body.appid !== config.appid || !id(body.out_trade_no)
      || typeof config.notifyUrl !== 'string' || !config.notifyUrl.startsWith('https://') || body.notify_url !== config.notifyUrl
      || !Number.isSafeInteger(body.amount?.total) || body.amount.total <= 0 || body.amount.currency !== 'CNY'
      || typeof body.payer?.openid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.payer.openid)
      || typeof body.description !== 'string' || !body.description || Buffer.byteLength(body.description) > 127)) fail();
  } else if (prepay || close) {
    const sub = body.sub_orders?.[0];
    if (body.combine_appid !== config.appid || !Array.isArray(body.sub_orders) || body.sub_orders.length !== 1
      || !sub || sub.mchid !== config.platformMchid || !merchant(sub.sub_mchid) || sub.sub_mchid === config.platformMchid
      || !id(sub.out_trade_no) || (close && close[1] !== sub.out_trade_no)) fail();
    if (prepay && (body.combine_mchid !== config.platformMchid || body.combine_out_trade_no !== sub.out_trade_no
      || typeof config.notifyUrl !== 'string' || !config.notifyUrl.startsWith('https://') || body.notify_url !== config.notifyUrl
      || !Number.isSafeInteger(sub.amount?.total_amount) || sub.amount.total_amount <= 0
      || sub.amount.currency !== 'CNY' || sub.settle_info?.profit_sharing !== true)) fail();
  } else {
    const receiver = body.receivers?.[0];
    if (body.appid !== config.appid || !merchant(body.sub_mchid) || body.sub_mchid === config.platformMchid
      || !id(body.out_order_no) || typeof body.transaction_id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(body.transaction_id)
      || body.finish !== true || !Array.isArray(body.receivers) || body.receivers.length !== 1
      || receiver?.type !== 'MERCHANT_ID' || receiver.receiver_account !== config.platformMchid
      || !Number.isSafeInteger(receiver.amount) || receiver.amount <= 0) fail();
  }
  if (await consume(event) !== true) fail();
  // A slow guard may consume the request after the caller has stopped observing. Do not submit an expired signature.
  verifyRelayRequest('POST', event, event.body, config, clock());
  const response = await requestCombineOrder({ protocol: 'https:', hostname: 'api.mch.weixin.qq.com', port: 443,
    method: 'POST', path: event.path, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, maxHeaderSize: 16384,
    headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(event.body), 'Wechatpay-Serial': config.wechatPublicKeyId,
      Authorization: event.authorization } }, request, event.body, close || directClose ? [204] : [200]);
  return { statusCode: response.statusCode, headers: response.headers, bodyBase64: response.body.toString('base64') };
}
exports.relayMutation = relayMutation;
exports.main = async event => {
  try {
    const plain = process.env.PAYMENT_MUTATION_RELAY_CONFIG, encoded = process.env.PAYMENT_MUTATION_RELAY_CONFIG_B64;
    if (plain && encoded) fail();
    const config = JSON.parse((encoded ? Buffer.from(encoded, 'base64').toString('utf8') : plain) || 'null');
    const { userInfo, tcbContext, ...request } = event || {};
    return { ok: true, data: await relayMutation(request, config) };
  } catch { return { ok: false, code: 'PAYMENT_RELAY_FAILED' }; }
};
