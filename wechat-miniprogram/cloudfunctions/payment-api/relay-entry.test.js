const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildSignedRequest } = require('./wechat-query');
const fixture = require('./test-query-fixture').createQueryFixture(require('./test-notification-fixture').createNotificationFixture().config);
const config = { enabled: true, mutationsEnabled: true, appid: 'wx_test', platformMchid: fixture.config.platformMchid,
  merchantSerial: fixture.config.merchantSerial, wechatPublicKeyId: fixture.config.wechatPublicKeyId,
  merchantPublicKey: fixture.publicKey.export({ type: 'spki', format: 'pem' }) };

function load(mode, env, request, consume) {
  const sandbox = { exports: {}, Buffer, process: { env }, require(name) {
    if (name === 'node:https') return { request };
    if (name === './mutation-replay-guard') return { consumeThroughPrivateGuard: consume };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/${mode}-relay.js`, 'utf8'), sandbox);
  return sandbox.exports.main;
}

for (const mode of ['query', 'mutation']) test(`${mode} entry tolerates platform metadata but never trusts it or discards business overrides`, async () => {
  const method = mode === 'query' ? 'GET' : 'POST';
  const path = mode === 'query' ? `/v3/combine-transactions/out-trade-no/${'a'.repeat(32)}` : '/v3/ecommerce/profitsharing/orders';
  const body = mode === 'query' ? '' : JSON.stringify({ appid: 'wx_test', sub_mchid: '1900000002',
    transaction_id: '420000000001', out_order_no: 'a'.repeat(32), finish: true,
    receivers: [{ type: 'MERCHANT_ID', receiver_account: config.platformMchid, amount: 2000 }] });
  const signed = buildSignedRequest(method, path, body, fixture.config, Date.now());
  const event = { path, authorization: signed.headers.Authorization, ...(body ? { body } : {}),
    userInfo: { openId: 'forged' }, tcbContext: { administrator: true } };
  let requests = 0, permits = 0;
  const main = load(mode, { [`PAYMENT_${mode.toUpperCase()}_RELAY_CONFIG_B64`]: Buffer.from(JSON.stringify(config)).toString('base64') },
    fixture.requestFor({ statusCode: 200, headers: {}, body: Buffer.from('{}') }, () => { requests++; }), async data => {
      permits++; assert.equal(Object.hasOwn(data,'userInfo'), false); assert.equal(Object.hasOwn(data,'tcbContext'), false); return true;
    });
  assert.equal((await main(event)).ok, true);
  assert.equal(requests, 1); assert.equal(permits, mode === 'mutation' ? 1 : 0);
  for (const invalid of [{ ...event, authorization: 'forged' }, { ...event, amountFen: 1 },
    { userInfo: event.userInfo, tcbContext: event.tcbContext }]) {
    const result = await main(invalid);
    assert.equal(result.ok, false); assert.equal(result.code, 'PAYMENT_RELAY_FAILED');
  }
  assert.equal(requests, 1); assert.equal(permits, mode === 'mutation' ? 1 : 0);
});
