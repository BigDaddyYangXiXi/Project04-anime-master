const https = require('node:https');
const { buildSignedRequest, requestCombineOrder } = require('./wechat-query');
const { verifyMessage } = require('./wechat-verification');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Internal adapter only. Caller must persist approval, amount reservation and this immutable ID first.
// Deployment and operator authorization are separate from the internal adapter and relay transport.
function validate(refund, config) {
  if (!config || !refund || refund.payment_mode !== 'DIRECT' || refund.platform_mchid !== config.platformMchid) fail('REFUND_IDENTITY_MISMATCH');
  if (!/^[a-f0-9]{32}$/.test(refund.id || '') || !/^[a-f0-9]{32}$/.test(refund.payment_id || '')
    || !/^[A-Za-z0-9_-]{1,32}$/.test(refund.transaction_id || '') || refund.currency !== 'CNY'
    || !Number.isSafeInteger(refund.amount_fen) || refund.amount_fen <= 0
    || !Number.isSafeInteger(refund.total_fen) || refund.total_fen < refund.amount_fen) fail('REFUND_INPUT_INVALID');
}
function buildRefundRequest(refund, config, now = Date.now()) {
  if (config?.refundEnabled !== true) fail('REFUND_NOT_ENABLED');
  validate(refund, config);
  if (refund.status !== 'APPROVED') fail('REFUND_NOT_APPROVED');
  if (typeof refund.reason !== 'string' || !refund.reason.trim() || Buffer.byteLength(refund.reason) > 80) fail('REFUND_INPUT_INVALID');
  let callback;
  try { callback = new URL(config.refundNotifyUrl); } catch { fail('REFUND_CALLBACK_NOT_CONFIGURED'); }
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash || callback.search
    || Buffer.byteLength(config.refundNotifyUrl) > 256) fail('REFUND_CALLBACK_NOT_CONFIGURED');
  const body = JSON.stringify({ transaction_id: refund.transaction_id, out_refund_no: refund.id,
    reason: refund.reason, notify_url: config.refundNotifyUrl,
    amount: { refund: refund.amount_fen, total: refund.total_fen, currency: 'CNY' } });
  const options = buildSignedRequest('POST', '/v3/refund/domestic/refunds', body, config, now);
  options.headers['Content-Type'] = 'application/json';
  options.headers['Content-Length'] = Buffer.byteLength(body);
  return { options, body };
}
function readRefundResult(response, refund, config, now) {
  validate(refund, config);
  const raw = verifyMessage(response.body, response.headers, config, now);
  let result;
  try { result = JSON.parse(raw.toString('utf8')); } catch { fail('REFUND_RESPONSE_INVALID'); }
  return normalizeRefundResult(result, refund, config, now);
}
// Internal: called only after response verification or notification verification and decryption.
function normalizeRefundResult(result, refund, config, now) {
  validate(refund, config);
  if (!result || typeof result !== 'object' || Array.isArray(result)
    || !/^[A-Za-z0-9_-]{1,32}$/.test(result.refund_id || '')
    || result.out_refund_no !== refund.id || result.transaction_id !== refund.transaction_id
    || result.out_trade_no !== refund.payment_id || result.amount?.refund !== refund.amount_fen
    || result.amount?.total !== refund.total_fen || result.amount?.currency !== 'CNY'
    || !['PROCESSING', 'SUCCESS', 'CLOSED', 'ABNORMAL'].includes(result.status)) fail('REFUND_RESULT_MISMATCH');
  let succeededAt = null;
  if (result.status === 'SUCCESS') {
    if (typeof result.success_time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(result.success_time)) fail('REFUND_RESPONSE_INVALID');
    succeededAt = Date.parse(result.success_time);
    if (!Number.isSafeInteger(succeededAt) || succeededAt <= 0 || succeededAt > now + 300000) fail('REFUND_RESPONSE_INVALID');
  }
  // Do not return the payer's receiving-account description or other unnecessary upstream data.
  return { refundId: refund.id, channelRefundId: result.refund_id, status: result.status,
    amountFen: refund.amount_fen, succeededAt };
}
async function submitRefund(refund, config, request = https.request, clock = Date.now) {
  const { options, body } = buildRefundRequest(refund, config, clock());
  const response = config.mutationRelay === true
    ? await require('./query-relay-client').mutateThroughRelay(options, body, config.mutationRelayInvoke)
    : await requestCombineOrder(options, request, body, [200]);
  const receipt = readRefundResult(response, refund, config, clock());
  // API acceptance is not final success. Persistence must await a query or verified notification.
  return { refundId: receipt.refundId, channelRefundId: receipt.channelRefundId, status: 'PROCESSING' };
}
async function queryRefund(refund, config, request = https.request, clock = Date.now) {
  validate(refund, config);
  const options = buildSignedRequest('GET', `/v3/refund/domestic/refunds/${refund.id}`, '', config, clock());
  const response = config.queryRelay === true
    ? await require('./query-relay-client').queryThroughRelay(options, config.queryRelayInvoke)
    : await requestCombineOrder(options, request, '', [200, 404]);
  if (response.statusCode !== 200) {
    verifyMessage(response.body, response.headers, config, clock());
    // A missing channel record cannot release the reservation or authorize resubmission.
    fail('REFUND_QUERY_UNRESOLVED');
  }
  return readRefundResult(response, refund, config, clock());
}
module.exports = { buildRefundRequest, readRefundResult, normalizeRefundResult, submitRefund, queryRefund };
