const test = require('node:test');
const assert = require('node:assert/strict');
const { consumeMutation, main } = require('./mutation-replay-guard');
const { buildSignedRequest } = require('./wechat-query');
const fixture = require('./test-query-fixture').createQueryFixture(require('./test-notification-fixture').createNotificationFixture().config);
const now = 1790179200000;
const config = { enabled: true, mutationsEnabled: true, platformMchid: fixture.config.platformMchid,
  merchantSerial: fixture.config.merchantSerial, wechatPublicKeyId: fixture.config.wechatPublicKeyId,
  merchantPublicKey: fixture.publicKey.export({ type: 'spki', format: 'pem' }) };
function event() {
  const path = '/v3/ecommerce/profitsharing/orders', body = '{}';
  return { path, body, authorization: buildSignedRequest('POST', path, body, fixture.config, now).headers.Authorization };
}

test('invalid or unsigned replay permits never reach database', async () => {
  const pool = { execute() { assert.fail('must not write'); } }, valid = event();
  for (const request of [null, {}, { ...valid, body: '{ }' }, { ...valid, path: '/v3/foreign' },
    { ...valid, body: 'x'.repeat(65537) }, { ...valid, authorization: 'forged' }]) {
    await assert.rejects(consumeMutation(pool, request, config, () => now));
  }
  await assert.rejects(consumeMutation(pool, valid, { ...config, mutationsEnabled: false }, () => now));
});

test('equivalent base64 signature spellings produce the same durable fingerprint', async () => {
  const request = event(), hashes = [];
  const signature = /signature="([^"]+)"/.exec(request.authorization)[1];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const index = signature.length - 3;
  const changed = signature.slice(0,index) + alphabet[alphabet.indexOf(signature[index]) + 1] + '==';
  assert.deepEqual(Buffer.from(changed,'base64'),Buffer.from(signature,'base64'));
  const pool = { async execute(sql, params) { hashes.push(params[0]); return [{ affectedRows: 1 }]; } };
  await consumeMutation(pool, request, config, () => now);
  await consumeMutation(pool, { ...request, authorization: request.authorization.replace(signature,changed) }, config, () => now);
  assert.match(hashes[0],/^[a-f0-9]{64}$/); assert.equal(hashes[0],hashes[1]);
});

test('uncertain storage result never grants permission and duplicate is a denial', async () => {
  const request = event();
  await assert.rejects(consumeMutation({ execute: async () => { throw Error('commit response lost'); } }, request, config, () => now));
  assert.equal(await consumeMutation({ execute: async () => { throw { code: 'ER_DUP_ENTRY' }; } }, request, config, () => now), false);
});

test('guard cloud entry defaults closed without company configuration', async () => {
  assert.deepEqual(await main({}), { ok: false, code: 'PAYMENT_MUTATION_GUARD_FAILED' });
});
