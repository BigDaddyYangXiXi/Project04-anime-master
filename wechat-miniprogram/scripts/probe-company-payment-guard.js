// Verifies private INSERT + uniqueness only; never invokes the public mutation relay.
const crypto = require('node:crypto');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const { buildSignedRequest } = require('../cloudfunctions/payment-api/wechat-query');
async function invoke(event) {
  const { stdout } = await execFile(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
    'api', 'scf', 'Invoke', '--api-version', '2018-04-16', '--body', JSON.stringify({
      FunctionName: 'payment-mutation-guard', Namespace: 'cloudbase-d2g65rqbvee0bd978',
      ClientContext: JSON.stringify(event), LogType: 'None' }), '--json'],
    { cwd: path.resolve(__dirname, '..'), timeout: 8000, maxBuffer: 65536 });
  const data = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1)).data;
  if (data?.Result?.InvokeResult !== 0) throw Error('GUARD_CALL_FAILED');
  return JSON.parse(data.Result.RetMsg);
}
async function probeGuard(config, call = invoke) {
  if (config.platformMchid !== '1750932981') throw Error('GUARD_MERCHANT_MISMATCH');
  const route = `/v3/pay/transactions/out-trade-no/${crypto.randomBytes(16).toString('hex')}/close`;
  const body = JSON.stringify({ mchid: config.platformMchid });
  const signed = buildSignedRequest('POST', route, body, config);
  const event = { path: route, body, authorization: signed.headers.Authorization };
  const first = await call(event);
  if (first?.ok !== true || first.consumed !== true) return { ok: false, code: 'GUARD_FIRST_CONSUMPTION_FAILED' };
  const second = await call(event);
  const rejected = second?.ok === true && second.consumed === false;
  return { ok: rejected, code: rejected ? 'GUARD_REPLAY_REJECTED' : 'GUARD_REPLAY_CHECK_FAILED',
    checkedAt: new Date().toISOString(), firstConsumed: true, duplicateRejected: rejected,
    replayRecordsAdded: 1, wechatMutationSubmitted: false, paymentCreated: false };
}
if (require.main === module) {
  (async () => {
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 32768) throw Error('INPUT_TOO_LARGE'); }
    const config = JSON.parse(input); input = '';
    config.publicKeys = new Map([[config.wechatPublicKeyId, config.wechatPublicKey]]);
    const result = await probeGuard(config);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  })().catch(() => { console.log(JSON.stringify({ ok: false, code: 'GUARD_PROBE_FAILED' })); process.exitCode = 1; });
}
module.exports = { probeGuard };
