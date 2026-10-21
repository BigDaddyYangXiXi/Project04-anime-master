const crypto = require('node:crypto');
const https = require('node:https');
const { buildSignedRequest, requestCombineOrder } = require('./wechat-query');
const { verifyMessage } = require('./wechat-verification');
const PATH = '/v3/ecommerce/profitsharing/orders';
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function validToken(value, max) { return typeof value === 'string' && new RegExp(`^[A-Za-z0-9_-]{1,${max}}$`).test(value); }
function finishTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) fail('SETTLEMENT_RESPONSE_INVALID');
  const time = Date.parse(value), zone = value.slice(-6);
  const offset = value.endsWith('Z') ? 0 : (zone[0] === '+' ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
  if (!Number.isSafeInteger(time) || time <= 0 || new Date(time + offset * 60000).toISOString().slice(0, 19) !== value.slice(0, 19)) fail('SETTLEMENT_RESPONSE_INVALID');
  return time;
}

function validateTask(task, config) {
  const s = task && task.snapshot;
  if (!task || !/^[a-f0-9]{32}$/.test(task.taskId || '') || !s || !validToken(s.transactionId, 32)
    || !/^\d{1,32}$/.test(s.subMchid || '') || !validToken(s.appid, 32)
    || !Number.isSafeInteger(s.platformFeeFen) || s.platformFeeFen <= 0
    || !Number.isSafeInteger(s.totalFen) || s.platformFeeFen > s.totalFen) fail('SETTLEMENT_INPUT_INVALID');
  if (!config || config.platformMchid !== s.platformMchid || config.appid !== s.appid
    || s.subMchid === s.platformMchid) fail('SETTLEMENT_MERCHANT_MISMATCH');
  return s;
}

function buildSettlementRequest(task, action, config, now = Date.now()) {
  const s = validateTask(task, config);
  let path = PATH, body = '', method;
  if (action === 'QUERY') {
    method = 'GET';
    path += `?sub_mchid=${encodeURIComponent(s.subMchid)}&transaction_id=${encodeURIComponent(s.transactionId)}&out_order_no=${task.taskId}`;
  } else if (action === 'SUBMIT') {
    method = 'POST';
    if (typeof config.platformReceiverName !== 'string' || !config.platformReceiverName.trim()
      || Buffer.byteLength(config.platformReceiverName) > 190) fail('SETTLEMENT_RECEIVER_NOT_CONFIGURED');
    let encryptedName;
    try {
      encryptedName = crypto.publicEncrypt({ key: config.publicKeys.get(config.wechatPublicKeyId),
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(config.platformReceiverName)).toString('base64');
    } catch { fail('SETTLEMENT_RECEIVER_NOT_CONFIGURED'); }
    body = JSON.stringify({ appid: s.appid, sub_mchid: s.subMchid, transaction_id: s.transactionId,
      out_order_no: task.taskId, receivers: [{ type: 'MERCHANT_ID', receiver_account: s.platformMchid,
        amount: s.platformFeeFen, description: '平台服务费', receiver_name: encryptedName }], finish: true });
  } else fail('SETTLEMENT_INPUT_INVALID');
  const options = buildSignedRequest(method, path, body, config, now);
  if (body) { options.headers['Content-Type'] = 'application/json'; options.headers['Content-Length'] = Buffer.byteLength(body); }
  return { options, body };
}

function verifySettlementResponse(response, task, action, config, now = Date.now()) {
  const s = validateTask(task, config);
  let data;
  const raw = verifyMessage(response.body, response.headers, config, now);
  try { data = JSON.parse(raw.toString('utf8')); } catch { fail('SETTLEMENT_RESPONSE_INVALID'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('SETTLEMENT_RESPONSE_INVALID');
  if (action === 'QUERY' && response.statusCode === 404 && data.code === 'RESOURCE_NOT_EXISTS') return { status: 'NOT_FOUND' };
  if (response.statusCode !== 200 || data.sub_mchid !== s.subMchid || data.transaction_id !== s.transactionId
    || data.out_order_no !== task.taskId || !validToken(data.order_id, 64)
    || !Array.isArray(data.receivers) || data.receivers.length !== 1) fail('SETTLEMENT_RESPONSE_INVALID');
  const r = data.receivers[0];
  if (!r || r.type !== 'MERCHANT_ID' || r.receiver_account !== s.platformMchid || r.amount !== s.platformFeeFen
    || !['PENDING', 'SUCCESS', 'CLOSED'].includes(r.result)) fail('SETTLEMENT_RESPONSE_INVALID');
  if (data.status !== undefined && !['PROCESSING', 'FINISHED'].includes(data.status)) fail('SETTLEMENT_RESPONSE_INVALID');
  // POST is acceptance only. A final receiver result is accepted only from the subsequent signed query.
  if (action === 'SUBMIT' || data.status === 'PROCESSING') return { status: 'PROCESSING', channelOrderId: data.order_id };
  if (action !== 'QUERY' || data.status !== 'FINISHED' || r.result === 'PENDING'
    || !validToken(r.detail_id, 64)) fail('SETTLEMENT_RESPONSE_INVALID');
  if (data.finish_amount !== undefined && (!Number.isSafeInteger(data.finish_amount) || data.finish_amount < 0
    || data.finish_amount > s.totalFen)) fail('SETTLEMENT_RESPONSE_INVALID');
  return { status: r.result === 'SUCCESS' ? 'FEE_SUCCEEDED' : 'CLOSED', channelOrderId: data.order_id,
    detailId: r.detail_id, platformFeeFen: r.amount, finishedAt: finishTime(r.finish_time),
    finishAmountFen: data.finish_amount === undefined ? null : data.finish_amount,
    failReason: r.result === 'CLOSED' && validToken(r.fail_reason, 64) ? r.fail_reason : null };
}

// Called only by an internal executor after product, refund and channel-amount gates.
async function callSettlement(task, action, config, request = https.request, clock = Date.now) {
  if (!config || config.settlementEnabled !== true) fail('SETTLEMENT_NOT_ENABLED');
  const { options, body } = buildSettlementRequest(task, action, config, clock());
  const response = action === 'QUERY' && config.queryRelay === true
    ? await require('./query-relay-client').queryThroughRelay(options, config.queryRelayInvoke)
    : action === 'SUBMIT' && config.mutationRelay === true
      ? await require('./query-relay-client').mutateThroughRelay(options, body, config.mutationRelayInvoke)
    : await requestCombineOrder(options, request, body, action === 'QUERY' ? [200, 404] : [200]);
  return verifySettlementResponse(response, task, action, config, clock());
}
module.exports = { buildSettlementRequest, verifySettlementResponse, callSettlement };
