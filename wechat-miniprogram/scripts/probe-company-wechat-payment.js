// Credentials arrive only through redirected stdin, never command arguments or disk output.
const crypto = require('node:crypto');
const https = require('node:https');
const { buildQueryRequest, buildSignedRequest, requestCombineOrder } = require('../cloudfunctions/payment-api/wechat-query');
const { verifyMessage } = require('../cloudfunctions/payment-api/wechat-verification');
async function probe(config, request = https.request, clock = Date.now, relay = null, refund = false) {
  if (config.platformMchid !== '1750932981') throw Error('PROBE_MERCHANT_MISMATCH');
  const id = crypto.randomBytes(16).toString('hex');
  const options = refund ? buildSignedRequest('GET', `/v3/refund/domestic/refunds/${id}`, '', config, clock())
    : buildQueryRequest(id, config, clock(), 'DIRECT');
  const response = relay ? await relay(options) : await requestCombineOrder(options, request, '', [200, 400, 401, 403, 404]);
  let verified;
  try { verified = verifyMessage(response.body, response.headers, config, clock()); }
  catch {
    let upstream;
    try { upstream = JSON.parse(response.body.toString('utf8')); } catch {}
    const known = ['SIGN_ERROR', 'PARAM_ERROR', 'NO_AUTH', 'INVALID_REQUEST', 'MCH_NOT_EXISTS', 'RESOURCE_NOT_EXISTS'];
    return { ok: false, status: response.statusCode, responseSignatureVerified: false,
      code: 'PROBE_RESPONSE_NOT_VERIFIED',
      unverifiedErrorCode: known.includes(upstream?.code) ? upstream.code : 'UNKNOWN',
      unverifiedMessage: known.includes(upstream?.code) && typeof upstream.message === 'string'
        ? upstream.message.replace(/[A-Za-z0-9+/=_-]{16,}/g, '[redacted]').slice(0, 200) : undefined,
      signatureHeaderPresent: Object.keys(response.headers).some(key => key.toLowerCase() === 'wechatpay-signature'),
      paymentCreated: false, apiV3DecryptionVerified: false, appidBindingVerified: false };
  }
  const body = JSON.parse(verified.toString('utf8'));
  const absent = response.statusCode === 404 && (refund ? ['RESOURCE_NOT_EXISTS'] : ['ORDERNOTEXIST', 'ORDER_NOT_EXIST']).includes(body?.code);
  return { ok: absent, checkedAt: new Date(clock()).toISOString(), status: response.statusCode,
    responseSignatureVerified: true, merchantQueryAccepted: absent,
    code: absent ? (refund ? 'PROBE_REFUND_ABSENT' : 'PROBE_ORDER_ABSENT') : 'PROBE_UNEXPECTED_RESPONSE',
    paymentCreated: false, apiV3DecryptionVerified: false, appidBindingVerified: false };
}
if (require.main === module) {
  (async () => {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 32768) throw Error('PROBE_INPUT_INVALID');
    }
    const config = JSON.parse(input); input = '';
    config.publicKeys = new Map([[config.wechatPublicKeyId, config.wechatPublicKey]]);
    let relay;
    if (process.argv.includes('--cloud-relay')) {
      const { promisify } = require('node:util');
      const execFile = promisify(require('node:child_process').execFile);
      const path = require('node:path');
      const { queryThroughRelay } = require('../cloudfunctions/payment-api/query-relay-client');
      relay = options => queryThroughRelay(options, async event => {
        const { stdout } = await execFile(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
          'api', 'scf', 'Invoke', '--api-version', '2018-04-16', '--body', JSON.stringify({
            FunctionName: 'payment-query-relay', Namespace: 'cloudbase-d2g65rqbvee0bd978',
            ClientContext: JSON.stringify(event), LogType: 'None' }), '--json'],
          { cwd: path.resolve(__dirname, '..'), timeout: 15000, maxBuffer: 1024 * 1024 });
        const data = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)).data;
        if (data?.Result?.InvokeResult !== 0) throw Error('CLOUD_QUERY_FAILED');
        return { result: JSON.parse(data.Result.RetMsg) };
      });
    }
    const result = await probe(config, https.request, Date.now, relay, process.argv.includes('--refund'));
    result.transport = relay ? 'company-cloud-query-relay' : 'local-https';
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  })().catch(error => {
    const allowed = new Set(['PAYMENT_SIGNATURE_INVALID', 'PAYMENT_SIGNATURE_EXPIRED', 'PAYMENT_UNKNOWN_KEY',
      'PAYMENT_QUERY_TIMEOUT', 'PAYMENT_QUERY_TRANSPORT_FAILED', 'PAYMENT_QUERY_FAILED', 'PAYMENT_VERIFIER_NOT_CONFIGURED']);
    console.log(JSON.stringify({ ok: false, code: allowed.has(error.code) ? error.code : 'PAYMENT_PROBE_FAILED' }));
    process.exitCode = 1;
  });
}
module.exports = { probe };
