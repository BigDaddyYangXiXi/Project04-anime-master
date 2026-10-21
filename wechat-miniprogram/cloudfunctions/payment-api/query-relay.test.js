const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQueryRequest, queryPayment } = require('./wechat-query');
const { relayQuery } = require('./query-relay');
const { queryThroughRelay } = require('./query-relay-client');
const { createNotificationFixture } = require('./test-notification-fixture');
const { createQueryFixture } = require('./test-query-fixture');
const notification = createNotificationFixture();
const fixture = createQueryFixture(notification.config);
const now = 1788675600000, id = 'a'.repeat(32);
const config = { enabled: true, platformMchid: fixture.config.platformMchid,
  merchantSerial: fixture.config.merchantSerial, wechatPublicKeyId: fixture.config.wechatPublicKeyId,
  merchantPublicKey: fixture.publicKey.export({ type: 'spki', format: 'pem' }) };
const options = () => buildQueryRequest(id, fixture.config, now);
const event = () => { const o = options(); return { path: o.path, authorization: o.headers.Authorization }; };
const denied = () => assert.fail('Rejected request must not reach WeChat');

test('deployed relay reads encoded configuration and rejects conflicting or invalid values before HTTP', async () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const plain = JSON.stringify(config), encoded = Buffer.from(plain).toString('base64');
  for (const [environment, expected] of [
    [{ PAYMENT_QUERY_RELAY_CONFIG_B64: encoded }, true],
    [{ PAYMENT_QUERY_RELAY_CONFIG: plain }, true],
    [{ PAYMENT_QUERY_RELAY_CONFIG: plain, PAYMENT_QUERY_RELAY_CONFIG_B64: encoded }, false],
    [{ PAYMENT_QUERY_RELAY_CONFIG_B64: 'invalid-json' }, false]
  ]) {
    let calls = 0;
    const sandbox = { exports: {}, Buffer, Date: { now: () => now }, process: { env: environment }, require(name) {
      if (name === './wechat-query') return { requestCombineOrder: async () => {
        calls++; return { statusCode: 200, headers: {}, body: Buffer.from('original') };
      } };
      return require(name);
    } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./query-relay'), 'utf8'), sandbox);
    const result = await sandbox.exports.main(event());
    assert.equal(result.ok, expected);
    assert.equal(calls, expected ? 1 : 0);
    if (expected) assert.equal(Buffer.from(result.data.bodyBase64, 'base64').toString(), 'original');
  }
});

test('relay authenticates exact signed GET and preserves original response bytes', async () => {
  const raw = Buffer.from(' {"note":"中文"}\n');
  const result = await relayQuery(event(), config, fixture.requestFor({ statusCode: 200, body: raw }, o => {
    assert.equal(o.hostname, 'api.mch.weixin.qq.com');
    assert.equal(o.method, 'GET'); assert.equal(o.rejectUnauthorized, true);
    assert.equal(o.minVersion, 'TLSv1.2');
  }), () => now);
  assert.deepEqual(Buffer.from(result.bodyBase64, 'base64'), raw);
});

test('relay rejects unsigned, tampered, expired, foreign and mutation requests before network access', async () => {
  const valid = event();
  for (const bad of [null, {}, { ...valid, path: valid.path.replace(id, 'b'.repeat(32)) },
    { ...valid, path: '/v3/combine-transactions/jsapi' }, { ...valid, method: 'POST' },
    { ...valid, host: 'attacker.test' }, { ...valid, authorization: valid.authorization.replace('nonce_str="', 'nonce_str="b') }]) {
    await assert.rejects(relayQuery(bad, config, denied, () => now), { code: 'PAYMENT_RELAY_REJECTED' });
  }
  for (const changed of [{ enabled: false }, { platformMchid: '123' }, { merchantSerial: 'BAD' }, { merchantPublicKey: 'bad' }]) {
    await assert.rejects(relayQuery(valid, { ...config, ...changed }, denied, () => now), { code: 'PAYMENT_RELAY_REJECTED' });
  }
  for (const offset of [-31000,31000]) await assert.rejects(relayQuery(valid, config, denied, () => now + offset), { code: 'PAYMENT_RELAY_REJECTED' });
});

test('client refuses failed, oversized and noncanonical envelopes and redacts upstream errors', async () => {
  const good = { statusCode: 200, headers: {}, bodyBase64: '' };
  for (const data of [{ ...good, statusCode: 302 }, { ...good, bodyBase64: '!' },
    { ...good, bodyBase64: 'a'.repeat(2796205) }, { ...good, headers: { x: 123 } }]) {
    await assert.rejects(queryThroughRelay(options(), async () => ({ result: { ok: true, data } })), { code: 'PAYMENT_RELAY_FAILED' });
  }
  await assert.rejects(queryThroughRelay(options(), async () => { throw Error('secret'); }), error => error.message === 'PAYMENT_RELAY_FAILED');
});

test('split query still verifies WeChat signature before interpreting ORDERNOTEXIST', async () => {
  const response = { ...notification.sign(JSON.stringify({ code: 'ORDERNOTEXIST' }), now), statusCode: 404 };
  const pool = { execute: async () => [[{ platform_mchid: config.platformMchid }]],
    getConnection: denied };
  const invoke = async payload => ({ result: { ok: true,
    data: await relayQuery(payload, config, fixture.requestFor(response), () => now) } });
  await assert.rejects(queryPayment(pool, id, { ...fixture.config, queryRelay: true, queryRelayInvoke: invoke }, denied, () => now),
    { code: 'PAYMENT_CHANNEL_ORDER_NOT_FOUND' });
  const tamper = async payload => {
    const reply = await invoke(payload);
    reply.result.data.bodyBase64 = Buffer.concat([response.body, Buffer.from(' ')]).toString('base64');
    return reply;
  };
  await assert.rejects(queryPayment(pool, id, { ...fixture.config, queryRelay: true, queryRelayInvoke: tamper }, denied, () => now),
    { code: 'PAYMENT_SIGNATURE_INVALID' });
});

test('client bounds bridge waiting and never automatically resubmits', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const pending = queryThroughRelay(options(), () => { calls++; return new Promise(() => {}); });
  const rejected = assert.rejects(pending, { code: 'PAYMENT_RELAY_FAILED' });
  t.mock.timers.tick(10000);
  await rejected; assert.equal(calls, 1);
});
