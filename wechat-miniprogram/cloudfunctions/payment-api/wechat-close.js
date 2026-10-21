const https = require('node:https');
const { buildSignedRequest, requestCombineOrder } = require('./wechat-query');
const { verifyMessage } = require('./wechat-verification');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Internal adapter only. A recovery worker must own the payment lease before calling.
function buildCloseRequest(payment, config, now = Date.now()) {
  if (!config || config.closeEnabled !== true) fail('PAYMENT_CLOSE_NOT_ENABLED');
  const mode = payment?.payment_mode || 'COMBINE';
  if (!['DIRECT', 'COMBINE'].includes(mode)) fail('PAYMENT_CLOSE_INPUT_INVALID');
  if (!payment || !/^[a-f0-9]{32}$/.test(payment.id || '') || payment.status !== 'CREATED'
    || !/^[A-Za-z0-9_-]{1,32}$/.test(payment.appid || '')
    || (mode === 'DIRECT' ? payment.sub_mchid !== null : (!/^[0-9]{1,32}$/.test(payment.sub_mchid || '')
    || payment.sub_mchid === payment.platform_mchid))) fail('PAYMENT_CLOSE_INPUT_INVALID');
  if (payment.appid !== config.appid || payment.platform_mchid !== config.platformMchid) fail('PAYMENT_IDENTITY_MISMATCH');
  const body = JSON.stringify(mode === 'DIRECT' ? { mchid: payment.platform_mchid } : { combine_appid: payment.appid, sub_orders: [{
    mchid: payment.platform_mchid, out_trade_no: payment.id, sub_mchid: payment.sub_mchid
  }] });
  const options = buildSignedRequest('POST', `/v3/${mode === 'DIRECT' ? 'pay/transactions' : 'combine-transactions'}/out-trade-no/${payment.id}/close`, body, config, now);
  options.headers['Content-Type'] = 'application/json';
  options.headers['Content-Length'] = Buffer.byteLength(body);
  return { options, body };
}

// No database mutation, retry or replacement order. A verified query resolves the final state.
async function closePrepay(payment, config, request = https.request, clock = Date.now) {
  const { options, body } = buildCloseRequest(payment, config, clock());
  const response = config.mutationRelay === true
    ? await require('./query-relay-client').mutateThroughRelay(options, body, config.mutationRelayInvoke)
    : await requestCombineOrder(options, request, body, [204]);
  const raw = verifyMessage(response.body, response.headers, config, clock());
  if (raw.length !== 0) fail('PAYMENT_CLOSE_RESPONSE_INVALID');
  return { status: 'QUERY_REQUIRED' };
}

module.exports = { buildCloseRequest, closePrepay };
