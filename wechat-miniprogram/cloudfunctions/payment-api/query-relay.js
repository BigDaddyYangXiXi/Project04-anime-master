const { verifyRelayRequest } = require('./relay-auth');
const https = require('node:https');
const { requestCombineOrder } = require('./wechat-query');

function fail() { const error = new Error('PAYMENT_RELAY_REJECTED'); error.code = error.message; throw error; }

// Read-only relay. A merchant-signed GET is the capability; no private key or SQL is needed here.
async function relayQuery(event, config, request = https.request, clock = Date.now) {
  if (!config || config.enabled !== true || !event || Object.keys(event).some(k => !['path','authorization'].includes(k))
    || typeof event.path !== 'string' || ![
      /^\/v3\/combine-transactions\/out-trade-no\/[a-f0-9]{32}$/,
      /^\/v3\/refund\/domestic\/refunds\/[a-f0-9]{32}$/,
      /^\/v3\/pay\/transactions\/out-trade-no\/[a-f0-9]{32}\?mchid=\d{1,32}$/,
      /^\/v3\/ecommerce\/profitsharing\/orders\?sub_mchid=\d{1,32}&transaction_id=[A-Za-z0-9_-]{1,32}&out_order_no=[a-f0-9]{32}$/
    ].some(pattern => pattern.test(event.path))
    || typeof event.authorization !== 'string' || event.authorization.length > 1500) fail();
  verifyRelayRequest('GET', event, '', config, clock());
  if (event.path.startsWith('/v3/pay/transactions/') && event.path.split('?mchid=')[1] !== config.platformMchid) fail();
  const result = await requestCombineOrder({ protocol: 'https:', hostname: 'api.mch.weixin.qq.com', port: 443,
    method: 'GET', path: event.path, rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false, maxHeaderSize: 16384,
    headers: { Accept: 'application/json', 'Accept-Encoding': 'identity',
      'Wechatpay-Serial': config.wechatPublicKeyId, Authorization: event.authorization } }, request, '', [200,404]);
  return { statusCode: result.statusCode, headers: result.headers, bodyBase64: result.body.toString('base64') };
}

exports.relayQuery = relayQuery;
exports.main = async event => {
  try {
    if (process.env.PAYMENT_QUERY_RELAY_CONFIG && process.env.PAYMENT_QUERY_RELAY_CONFIG_B64) fail();
    const value = process.env.PAYMENT_QUERY_RELAY_CONFIG_B64
      ? Buffer.from(process.env.PAYMENT_QUERY_RELAY_CONFIG_B64, 'base64').toString('utf8') : process.env.PAYMENT_QUERY_RELAY_CONFIG;
    const config = JSON.parse(value || 'null');
    const { userInfo, tcbContext, ...request } = event || {};
    return { ok: true, data: await relayQuery(request, config) };
  } catch {
    // Never return or log the capability, upstream response or configuration.
    return { ok: false, code: 'PAYMENT_RELAY_FAILED' };
  }
};
