const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildRefundRequest, submitRefund, queryRefund } = require('./wechat-refund');
const { createNotificationFixture } = require('./test-notification-fixture');
const { createQueryFixture } = require('./test-query-fixture');
const notification = createNotificationFixture(), fixture = createQueryFixture(notification.config);
const config = { ...fixture.config, refundEnabled: true, refundNotifyUrl: 'https://merchant.example/refund-notify' };
const now = 1788675600000;
const refund = { id: 'b'.repeat(32), payment_id: 'a'.repeat(32), transaction_id: 'wx_transaction_1',
  platform_mchid: config.platformMchid, payment_mode: 'DIRECT', status: 'APPROVED',
  currency: 'CNY', amount_fen: 3000, total_fen: 10000, reason: '双方协商退款' };
const receipt = { refund_id: 'wx_refund_1', out_refund_no: refund.id, out_trade_no: refund.payment_id,
  transaction_id: refund.transaction_id, status: 'PROCESSING', amount: { refund: 3000, total: 10000, currency: 'CNY' } };
const signed = value => ({ ...notification.sign(JSON.stringify(value), now), statusCode: 200 });
const code = expected => error => error.code === expected;
test('refund signs immutable original transaction, amount and refund ID with no selected funding account', () => {
  const { options, body } = buildRefundRequest(refund, config, now);
  assert.equal(options.path, '/v3/refund/domestic/refunds');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(body), { transaction_id: refund.transaction_id, out_refund_no: refund.id,
    reason: refund.reason, notify_url: config.refundNotifyUrl, amount: { refund: 3000, total: 10000, currency: 'CNY' } });
  const fields = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`POST\n${options.path}\n${fields.timestamp}\n${fields.nonce_str}\n${body}\n`), fixture.publicKey, Buffer.from(fields.signature, 'base64')), true);
  assert.equal(buildRefundRequest(refund, config, now).body, body);
});
test('disabled, unapproved, foreign, oversized and invalid refunds never construct a request', () => {
  assert.throws(() => buildRefundRequest(refund, { ...config, refundEnabled: false }), code('REFUND_NOT_ENABLED'));
  for (const patch of [{ status: 'PROCESSING' }, { payment_mode: 'COMBINE' }, { platform_mchid: '1' },
    { id: '../x' }, { amount_fen: 0 }, { amount_fen: 10001 }, { amount_fen: 1.5 }, { amount_fen: '3000' },
    { currency: 'USD' }, { reason: '中'.repeat(27) }, { reason: ' ' }]) {
    assert.throws(() => buildRefundRequest({ ...refund, ...patch }, config));
  }
  for (const refundNotifyUrl of ['http://example.com/', 'https://example.com/?x=1', 'https://user:pass@example.com/', undefined]) {
    assert.throws(() => buildRefundRequest(refund, { ...config, refundNotifyUrl }), code('REFUND_CALLBACK_NOT_CONFIGURED'));
  }
});
test('submission is accepted as processing even when immediate reply claims success', async () => {
  const response = signed({ ...receipt, status: 'SUCCESS', success_time: new Date(now - 1000).toISOString() });
  const result = await submitRefund(refund, config, fixture.requestFor(response, options => {
    assert.equal(options.headers['User-Agent'], 'Wanjiangwu-Payment/1.0');
    assert.equal(options.headers['Content-Length'], Buffer.byteLength(buildRefundRequest(refund, config, now).body));
  }), () => now);
  assert.deepEqual(result, { refundId: refund.id, channelRefundId: 'wx_refund_1', status: 'PROCESSING' });
});
test('query preserves signed processing, closed, abnormal and success states without exposing recipient data', async () => {
  for (const status of ['PROCESSING', 'CLOSED', 'ABNORMAL', 'SUCCESS']) {
    const result = await queryRefund(refund, config, fixture.requestFor(signed({ ...receipt, status,
      success_time: new Date(now - 1000).toISOString(), user_received_account: 'private recipient' }), options => {
      assert.equal(options.method, 'GET'); assert.equal(options.path, `/v3/refund/domestic/refunds/${refund.id}`);
    }), () => now);
    assert.equal(result.status, status);
    assert.equal(result.succeededAt, status === 'SUCCESS' ? now - 1000 : null);
    assert.ok(!JSON.stringify(result).includes('private recipient'));
  }
});
test('wrong binding, amounts, malformed success and tampered signatures are rejected', async () => {
  for (const patch of [{ out_refund_no: 'c'.repeat(32) }, { transaction_id: 'other' }, { out_trade_no: 'c'.repeat(32) },
    { amount: { ...receipt.amount, refund: 1 } }, { amount: { ...receipt.amount, currency: 'USD' } },
    { status: 'UNKNOWN' }, { status: 'SUCCESS' }, { status: 'SUCCESS', success_time: new Date(now + 600000).toISOString() }]) {
    await assert.rejects(queryRefund(refund, config, fixture.requestFor(signed({ ...receipt, ...patch })), () => now));
  }
  await assert.rejects(queryRefund(refund, config, fixture.requestFor({ ...signed(receipt), headers: {} }), () => now), code('PAYMENT_SIGNATURE_INVALID'));
  await assert.rejects(queryRefund(refund, config, fixture.requestFor({ ...signed(receipt), body: Buffer.from('{}') }), () => now), code('PAYMENT_SIGNATURE_INVALID'));
});
test('HTTP failure is not retried and configured relays are never bypassed', async () => {
  let calls = 0;
  await assert.rejects(submitRefund(refund, config, fixture.requestFor({ ...signed(receipt), statusCode: 500 }, () => calls++), () => now));
  assert.equal(calls, 1);
  const never = () => assert.fail('must not bypass a configured relay');
  await assert.rejects(submitRefund(refund, { ...config, mutationRelay: true, mutationRelayInvoke: async () => { throw Error('unavailable'); } }, never), code('PAYMENT_RELAY_FAILED'));
  await assert.rejects(queryRefund(refund, { ...config, queryRelay: true, queryRelayInvoke: async () => { throw Error('unavailable'); } }, never), code('PAYMENT_RELAY_FAILED'));
});

test('refund query uses signed relay, verifies response and preserves unknown results without retry', async () => {
  const { relayQuery } = require('./query-relay');
  const relayConfig = { enabled: true, platformMchid: config.platformMchid, merchantSerial: config.merchantSerial,
    wechatPublicKeyId: config.wechatPublicKeyId, merchantPublicKey: fixture.publicKey.export({ type: 'spki', format: 'pem' }) };
  const never = () => assert.fail('must use configured relay');
  let calls = 0;
  const invoke = response => async payload => {
    calls++;
    return { result: { ok: true, data: await relayQuery(payload, relayConfig, fixture.requestFor(response, options => {
      assert.equal(options.method, 'GET'); assert.equal(options.path, `/v3/refund/domestic/refunds/${refund.id}`);
    }), () => now) } };
  };
  const result = await queryRefund(refund, { ...config, queryRelay: true, queryRelayInvoke: invoke(signed(receipt)) }, never, () => now);
  assert.equal(result.status, 'PROCESSING'); assert.equal(calls, 1);
  await assert.rejects(queryRefund(refund, { ...config, queryRelay: true,
    queryRelayInvoke: invoke({ ...signed({ code: 'RESOURCE_NOT_EXISTS' }), statusCode: 404 }) }, never, () => now), code('REFUND_QUERY_UNRESOLVED'));
  assert.equal(calls, 2);
  await assert.rejects(queryRefund(refund, { ...config, queryRelay: true,
    queryRelayInvoke: invoke({ ...signed(receipt), body: Buffer.from('{}') }) }, never, () => now), code('PAYMENT_SIGNATURE_INVALID'));
  assert.equal(calls, 3);
});
