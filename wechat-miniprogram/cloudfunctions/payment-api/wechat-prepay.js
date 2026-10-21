const crypto = require('node:crypto');
const https = require('node:https');
const { buildSignedRequest, requestCombineOrder } = require('./wechat-query');
const { verifyMessage } = require('./wechat-verification');

function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Internal adapter: payment is the server-reserved snapshot, never a client form.
function buildPrepayRequest(payment, config, now = Date.now()) {
  if (!config || config.prepayEnabled !== true) fail('PAYMENT_PREPAY_NOT_ENABLED');
  const mode = payment?.payment_mode || 'COMBINE';
  if (!['COMBINE', 'DIRECT'].includes(mode) || mode !== (config.paymentMode || 'COMBINE')) fail('PAYMENT_IDENTITY_MISMATCH');
  if (!payment || !/^[a-f0-9]{32}$/.test(payment.id || '') || payment.status !== 'CREATED'
    || payment.currency !== 'CNY' || !Number.isSafeInteger(Number(payment.amount_fen)) || Number(payment.amount_fen) <= 0
    || !/^[A-Za-z0-9_-]{1,128}$/.test(payment.payer_openid || '')
    || (mode === 'DIRECT' ? payment.sub_mchid != null : (!/^[0-9]{1,32}$/.test(payment.sub_mchid || '') || payment.sub_mchid === payment.platform_mchid))
    || !/^[A-Za-z0-9_-]{1,32}$/.test(payment.appid || '')) fail('PAYMENT_PREPAY_INPUT_INVALID');
  if (payment.appid !== config.appid || payment.platform_mchid !== config.platformMchid) fail('PAYMENT_IDENTITY_MISMATCH');
  let callback;
  try { callback = new URL(config.notifyUrl); } catch { fail('PAYMENT_CALLBACK_NOT_CONFIGURED'); }
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash
    || callback.search || config.notifyUrl.length > 255) fail('PAYMENT_CALLBACK_NOT_CONFIGURED');
  const body = JSON.stringify(mode === 'DIRECT' ? {
    appid: payment.appid, mchid: payment.platform_mchid, out_trade_no: payment.id,
    description: '万匠屋-服务订单', notify_url: config.notifyUrl,
    amount: { total: Number(payment.amount_fen), currency: 'CNY' }, payer: { openid: payment.payer_openid }
  } : {
    combine_appid: payment.appid, combine_mchid: payment.platform_mchid, combine_out_trade_no: payment.id,
    combine_payer_info: { openid: payment.payer_openid }, notify_url: config.notifyUrl,
    sub_orders: [{ mchid: payment.platform_mchid, sub_mchid: payment.sub_mchid, out_trade_no: payment.id,
      attach: payment.id, description: '万匠屋-服务订单',
      amount: { total_amount: Number(payment.amount_fen), currency: 'CNY' }, settle_info: { profit_sharing: true } }]
  });
  const options = buildSignedRequest('POST', mode === 'DIRECT' ? '/v3/pay/transactions/jsapi' : '/v3/combine-transactions/jsapi', body, config, now);
  options.headers['Content-Type'] = 'application/json';
  options.headers['Content-Length'] = Buffer.byteLength(body);
  return { options, body };
}

function paymentArguments(prepayId, config, now) {
  if (typeof prepayId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(prepayId)
    || !Number.isSafeInteger(now) || now <= 0) fail('PAYMENT_PREPAY_INPUT_INVALID');
  const timeStamp = String(Math.floor(now / 1000)), nonceStr = crypto.randomBytes(16).toString('hex');
  const packageValue = `prepay_id=${prepayId}`;
  const message = `${config.appid}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  const paySign = crypto.sign('RSA-SHA256', Buffer.from(message), {
    key: config.merchantPrivateKey, padding: crypto.constants.RSA_PKCS1_PADDING
  }).toString('base64');
  return { timeStamp, nonceStr, package: packageValue, signType: 'RSA', paySign };
}

// No automatic retry: timeout leaves the reserved payment id intact for reconciliation.
async function createPrepay(payment, config, request = https.request, clock = Date.now) {
  const { options, body } = buildPrepayRequest(payment, config, clock());
  const response = config.mutationRelay === true
    ? await require('./query-relay-client').mutateThroughRelay(options, body, config.mutationRelayInvoke)
    : await requestCombineOrder(options, request, body, [200]);
  const now = clock();
  const raw = verifyMessage(response.body, response.headers, config, now);
  let result;
  try { result = JSON.parse(raw.toString('utf8')); } catch { fail('PAYMENT_PREPAY_RESPONSE_INVALID'); }
  if (!result || typeof result.prepay_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.prepay_id)) fail('PAYMENT_PREPAY_RESPONSE_INVALID');
  return { prepayId: result.prepay_id, paymentRequest: paymentArguments(result.prepay_id, config, now) };
}

module.exports = { buildPrepayRequest, createPrepay, paymentArguments };
