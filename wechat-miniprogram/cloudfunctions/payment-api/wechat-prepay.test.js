const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildPrepayRequest, createPrepay } = require('./wechat-prepay');
const { createNotificationFixture } = require('./test-notification-fixture');
const { createQueryFixture } = require('./test-query-fixture');
const notification = createNotificationFixture(), transport = createQueryFixture(notification.config);
const now = 1790179200000;
const config = { ...transport.config, appid: 'wx_test', prepayEnabled: true, notifyUrl: 'https://example.test/payment' };
const payment = { id: 'a'.repeat(32), appid: config.appid, platform_mchid: config.platformMchid,
  sub_mchid: '1900000002', payer_openid: 'test_payer', amount_fen: '10000', currency: 'CNY', status: 'CREATED' };

test('prepay signs immutable id, stored amount, trusted payer and deferred settlement flag', () => {
  const { body, options } = buildPrepayRequest(payment, config, now);
  const data = JSON.parse(body), sub = data.sub_orders[0];
  assert.equal(data.combine_out_trade_no, payment.id);
  assert.equal(sub.out_trade_no, payment.id);
  assert.equal(sub.amount.total_amount, 10000);
  assert.equal(sub.settle_info.profit_sharing, true);
  assert.equal(data.combine_payer_info.openid, payment.payer_openid);
  assert.equal(options.hostname, 'api.mch.weixin.qq.com');
  assert.equal(options.headers['Content-Length'], Buffer.byteLength(body));
  const signed = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`POST\n${options.path}\n${signed.timestamp}\n${signed.nonce_str}\n${body}\n`),
    transport.publicKey, Buffer.from(signed.signature, 'base64')), true);
});

test('disabled product, wrong identity and invalid amount fail before network access', async () => {
  let networkCalls = 0;
  const network = () => { networkCalls++; throw new Error('unexpected network'); };
  await assert.rejects(createPrepay(payment, { ...config, prepayEnabled: false }, network), { code: 'PAYMENT_PREPAY_NOT_ENABLED' });
  for (const patch of [{ appid: 'foreign' }, { platform_mchid: '999' }, { status: 'PAID' }, { amount_fen: 0 },
    { amount_fen: 'NaN' }, { amount_fen: 1.2 }, { sub_mchid: config.platformMchid }, { payer_openid: '' }]) {
    await assert.rejects(createPrepay({ ...payment, ...patch }, config, network));
  }
  assert.equal(networkCalls, 0);
});

test('verified WeChat prepay response produces independently verifiable phone signature', async () => {
  const response = notification.sign(JSON.stringify({ prepay_id: 'wx_prepay_123' }), now);
  const result = await createPrepay(payment, config, transport.requestFor(response), () => now);
  const args = result.paymentRequest;
  assert.equal(args.package, 'prepay_id=wx_prepay_123');
  const bytes = Buffer.from(`${config.appid}\n${args.timeStamp}\n${args.nonceStr}\n${args.package}\n`);
  assert.equal(crypto.verify('RSA-SHA256', bytes, transport.publicKey, Buffer.from(args.paySign, 'base64')), true);
  assert.deepEqual(Object.keys(args).sort(), ['nonceStr', 'package', 'paySign', 'signType', 'timeStamp']);
});

test('tampered or malformed channel responses never reach phone payment', async () => {
  const response = notification.sign(JSON.stringify({ prepay_id: 'safe' }), now);
  response.body = Buffer.from(JSON.stringify({ prepay_id: 'forged' }));
  await assert.rejects(createPrepay(payment, config, transport.requestFor(response), () => now), { code: 'PAYMENT_SIGNATURE_INVALID' });
  for (const body of ['{}', '{', '{"prepay_id":"bad\\nvalue"}']) {
    await assert.rejects(createPrepay(payment, config, transport.requestFor(notification.sign(body, now)), () => now),
      { code: 'PAYMENT_PREPAY_RESPONSE_INVALID' });
  }
});

test('callbacks cannot be plaintext, credential-bearing or fragment URLs', () => {
  for (const notifyUrl of ['http://example.test/payment', 'https://user:pass@example.test/payment', 'https://example.test/#fragment', 'not-a-url']) {
    assert.throws(() => buildPrepayRequest(payment, { ...config, notifyUrl }, now), { code: 'PAYMENT_CALLBACK_NOT_CONFIGURED' });
  }
});
