const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildCloseRequest, closePrepay } = require('./wechat-close');
const { createNotificationFixture } = require('./test-notification-fixture');
const { createQueryFixture } = require('./test-query-fixture');
const notification = createNotificationFixture(), transport = createQueryFixture(notification.config);
const now = 1790179200000;
const config = { ...transport.config, appid: 'wx_test', closeEnabled: true };
const payment = { id: 'a'.repeat(32), appid: config.appid, platform_mchid: config.platformMchid,
  sub_mchid: '1900000002', status: 'CREATED' };

test('close signs the original platform, submerchant and complete single suborder', () => {
  const { body, options } = buildCloseRequest(payment, config, now);
  assert.deepEqual(JSON.parse(body), { combine_appid: payment.appid, sub_orders: [{
    mchid: payment.platform_mchid, out_trade_no: payment.id, sub_mchid: payment.sub_mchid
  }] });
  assert.equal(options.hostname, 'api.mch.weixin.qq.com');
  assert.equal(options.path, `/v3/combine-transactions/out-trade-no/${payment.id}/close`);
  assert.equal(options.headers['Content-Length'], Buffer.byteLength(body));
  const signed = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`POST\n${options.path}\n${signed.timestamp}\n${signed.nonce_str}\n${body}\n`),
    transport.publicKey, Buffer.from(signed.signature, 'base64')), true);
});

test('verified empty 204 requires query rather than declaring local closure', async () => {
  const response = { ...notification.sign('', now), statusCode: 204 };
  assert.deepEqual(await closePrepay(payment, config, transport.requestFor(response), () => now), { status: 'QUERY_REQUIRED' });
});

test('unsigned, nonempty and unsuccessful close responses never become closure facts', async () => {
  const empty = notification.sign('', now);
  for (const response of [
    { ...empty, statusCode: 204, headers: {} },
    { ...notification.sign('{}', now), statusCode: 204 },
    ...[200, 202, 400, 404, 500].map(statusCode => ({ ...empty, statusCode }))
  ]) await assert.rejects(closePrepay(payment, config, transport.requestFor(response), () => now));
});

test('disabled close, foreign identity and paid snapshots never reach network', async () => {
  const network = () => assert.fail('unexpected network');
  await assert.rejects(closePrepay(payment, { ...config, closeEnabled: false }, network), { code: 'PAYMENT_CLOSE_NOT_ENABLED' });
  for (const patch of [{ appid: 'other' }, { platform_mchid: '999' }, { sub_mchid: '' }, { status: 'PAID' }, { id: '../bad' }]) {
    await assert.rejects(closePrepay({ ...payment, ...patch }, config, network));
  }
});

test('transport failure is not retried or converted into a closed order', async () => {
  let calls = 0;
  await assert.rejects(closePrepay(payment, config, () => { calls++; throw new Error('network lost'); }, () => now),
    { code: 'PAYMENT_QUERY_TRANSPORT_FAILED' });
  assert.equal(calls, 1);
  const signed = notification.sign('different bytes', now);
  await assert.rejects(closePrepay(payment, config, transport.requestFor({ ...signed, statusCode: 204, body: Buffer.alloc(0) }), () => now),
    { code: 'PAYMENT_SIGNATURE_INVALID' });
});
