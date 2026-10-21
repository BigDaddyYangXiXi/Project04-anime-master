const { test } = require('node:test');
const assert = require('node:assert/strict');
const { probe } = require('./probe-company-wechat-payment');
const { createNotificationFixture } = require('../cloudfunctions/payment-api/test-notification-fixture');
const { createQueryFixture } = require('../cloudfunctions/payment-api/test-query-fixture');
const notification = createNotificationFixture();
const fixture = createQueryFixture(notification.config);
const config = { ...fixture.config, platformMchid: '1750932981' };
const now = 1788675600000;
test('probe sends only a signed GET and accepts verified order absence', async () => {
  for (const code of ['ORDERNOTEXIST', 'ORDER_NOT_EXIST']) {
    const response = { ...notification.sign(JSON.stringify({ code }), now), statusCode: 404 };
    const result = await probe(config, fixture.requestFor(response, options => {
      assert.equal(options.method, 'GET');
      assert.equal(options.hostname, 'api.mch.weixin.qq.com');
      assert.equal(options.headers['User-Agent'], 'Wanjiangwu-Payment/1.0');
      assert.match(options.path, /^\/v3\/pay\/transactions\/out-trade-no\/[a-f0-9]{32}\?mchid=1750932981$/);
    }), () => now);
    assert.equal(result.ok, true);
    assert.equal(result.paymentCreated, false);
    assert.equal(result.apiV3DecryptionVerified, false);
    assert.equal(result.appidBindingVerified, false);
  }
});
test('unsigned errors cannot pass and long response tokens are redacted', async () => {
  const response = { body: Buffer.from(JSON.stringify({ code: 'INVALID_REQUEST', message: 'a'.repeat(64) })), headers: {}, statusCode: 400 };
  const result = await probe(config, fixture.requestFor(response), () => now);
  assert.equal(result.ok, false);
  assert.equal(result.responseSignatureVerified, false);
  assert.equal(result.unverifiedMessage, '[redacted]');
});
test('a signed unexpected response is not accepted as readiness', async () => {
  const result = await probe(config, fixture.requestFor({ ...notification.sign('{}', now), statusCode: 200 }), () => now);
  assert.equal(result.ok, false);
  assert.equal(result.responseSignatureVerified, true);
});
