const test = require('node:test');
const assert = require('node:assert/strict');
const { relayMutation } = require('./mutation-relay');
const { mutateThroughRelay } = require('./query-relay-client');
const { buildSignedRequest } = require('./wechat-query');
const { buildPrepayRequest, createPrepay } = require('./wechat-prepay');
const { buildCloseRequest, closePrepay } = require('./wechat-close');
const { buildSettlementRequest, callSettlement } = require('./wechat-settlement');
const signed = require('./test-notification-fixture').createNotificationFixture();
const transport = require('./test-query-fixture').createQueryFixture(signed.config);
const now = 1790179200000;
const config = { ...transport.config, appid: 'wx_test', notifyUrl: 'https://example.test/payment',
  prepayEnabled: true, closeEnabled: true, settlementEnabled: true, platformReceiverName: '测试平台' };
const relayConfig = { enabled: true, mutationsEnabled: true, appid: config.appid, notifyUrl: config.notifyUrl,
  platformMchid: config.platformMchid, merchantSerial: config.merchantSerial, wechatPublicKeyId: config.wechatPublicKeyId,
  merchantPublicKey: transport.publicKey.export({ type: 'spki', format: 'pem' }) };
const payment = { id: 'a'.repeat(32), appid: config.appid, platform_mchid: config.platformMchid,
  sub_mchid: '1900000002', payer_openid: 'test_payer', amount_fen: '10000', currency: 'CNY', status: 'CREATED' };
const task = { taskId: 'b'.repeat(32), snapshot: { transactionId: '420000000000001', appid: config.appid,
  platformMchid: config.platformMchid, subMchid: payment.sub_mchid, platformFeeFen: 2000, totalFen: 10000 } };
const requests = () => [buildPrepayRequest(payment, config, now), buildCloseRequest(payment, config, now),
  buildSettlementRequest(task, 'SUBMIT', config, now)];
const event = ({ options, body }) => ({ path: options.path, body, authorization: options.headers.Authorization });
const denied = () => assert.fail('No direct or unauthorized HTTP call allowed');
const refundConfig = { ...config, refundEnabled: true, refundNotifyUrl: 'https://example.test/refund' };
const refundRelayConfig = { ...relayConfig, refundEnabled: true, refundNotifyUrl: refundConfig.refundNotifyUrl };
const refund = { id: 'c'.repeat(32), payment_id: payment.id, platform_mchid: config.platformMchid,
  payment_mode: 'DIRECT', transaction_id: '420000000000001', status: 'APPROVED', amount_fen: 3000,
  total_fen: 10000, currency: 'CNY', reason: '双方协商退款' };
test('refund relay consumes before HTTPS and rejects duplicate signed submission', async () => {
  const { buildRefundRequest, submitRefund } = require('./wechat-refund');
  const { consumeMutation } = require('./mutation-replay-guard');
  const hashes = new Set();
  const pool = { execute: async (sql, [hash]) => {
    assert.match(sql, /^INSERT INTO payment_mutation_receipts/);
    if (hashes.has(hash)) throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    hashes.add(hash);
  } };
  const consume = payload => consumeMutation(pool, payload, refundRelayConfig, () => now);
  const response = { ...signed.sign(JSON.stringify({ refund_id: 'wx_refund', out_refund_no: refund.id,
    out_trade_no: refund.payment_id, transaction_id: refund.transaction_id, status: 'PROCESSING',
    amount: { refund: 3000, total: 10000, currency: 'CNY' } }), now), statusCode: 200 };
  let calls = 0;
  const request = transport.requestFor(response, options => {
    calls++; assert.ok(hashes.size > 0); assert.equal(options.path, '/v3/refund/domestic/refunds');
  });
  const fixed = event(buildRefundRequest(refund, refundConfig, now));
  await relayMutation(fixed, refundRelayConfig, request, () => now, consume);
  await assert.rejects(relayMutation(fixed, refundRelayConfig, request, () => now, consume), { code: 'PAYMENT_RELAY_REJECTED' });
  assert.equal(calls, 1);
  const result = await submitRefund(refund, { ...refundConfig, mutationRelay: true, mutationRelayInvoke: async payload => ({
    result: { ok: true, data: await relayMutation(payload, refundRelayConfig, request, () => now, consume) }
  }) }, denied, () => now);
  assert.equal(result.status, 'PROCESSING');
});
test('refund relay rejects disabled, altered callback, excess amounts and funding overrides before guard', async () => {
  const { buildRefundRequest } = require('./wechat-refund');
  const valid = event(buildRefundRequest(refund, refundConfig, now));
  await assert.rejects(relayMutation(valid, relayConfig, denied, () => now, denied));
  for (const patch of [{ notify_url: 'https://other.test/refund' }, { amount: { total: 10000, refund: 10001, currency: 'CNY' } },
    { funds_account: 'AVAILABLE' }, { amount: { total: 10000, refund: 3000, currency: 'USD' } }]) {
    const body = JSON.stringify({ ...JSON.parse(valid.body), ...patch });
    const options = buildSignedRequest('POST', valid.path, body, config, now);
    await assert.rejects(relayMutation({ path: valid.path, body, authorization: options.headers.Authorization }, refundRelayConfig, denied, () => now, denied));
  }
});
function invoke(response) {
  return async payload => ({ result: { ok: true,
    data: await relayMutation(payload, relayConfig, transport.requestFor(response), () => now, async () => true) } });
}

test('all three mutation routes send fixed HTTPS POST with exact signed bytes and preserve raw replies', async () => {
  for (const request of requests()) {
    let calls = 0, body;
    const statusCode = request.options.path.endsWith('/close') ? 204 : 200;
    const response = { statusCode, headers: {}, body: Buffer.from(statusCode === 204 ? '' : ' {"raw":"中文"}\n') };
    const network = (options, callback) => {
      calls++; assert.equal(options.hostname, 'api.mch.weixin.qq.com'); assert.equal(options.method, 'POST');
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, 'TLSv1.2');
      assert.equal(options.headers['Content-Length'], Buffer.byteLength(request.body));
      const client = transport.requestFor(response)(options, callback), end = client.end;
      client.end = value => { body = value; end(); }; return client;
    };
    const result = await relayMutation(event(request), relayConfig, network, () => now, async () => true);
    assert.equal(calls, 1); assert.equal(body, request.body);
    assert.deepEqual(Buffer.from(result.bodyBase64, 'base64'), response.body);
  }
});

test('mutation authorization binds path, method, original body, merchant and freshness', async () => {
  const valid = event(requests()[0]);
  for (const invalid of [null, {}, { ...valid, body: valid.body + ' ' }, { ...valid, host: 'other.test' },
    { ...valid, path: '/v3/refund/domestic/refunds' }, { ...valid, method: 'GET' }, { ...valid, body: 'x'.repeat(65537) }]) {
    await assert.rejects(relayMutation(invalid, relayConfig, denied, () => now), { code: 'PAYMENT_RELAY_REJECTED' });
  }
  for (const changed of [{ enabled: false }, { mutationsEnabled: false }, { platformMchid: '999' }, { appid: 'other' },
    { notifyUrl: 'https://other.test/payment' }, { merchantPublicKey: 'broken' }]) {
    await assert.rejects(relayMutation(valid, { ...relayConfig, ...changed }, denied, () => now), { code: 'PAYMENT_RELAY_REJECTED' });
  }
  await assert.rejects(relayMutation(valid, relayConfig, denied, () => now + 31000), { code: 'PAYMENT_RELAY_REJECTED' });
  const get = buildSignedRequest('GET', valid.path, '', config, now);
  await assert.rejects(relayMutation({ ...valid, authorization: get.headers.Authorization }, relayConfig, denied, () => now));
});

test('even signed requests cannot switch suborders, receiver or immutable channel identifiers', async () => {
  for (const request of requests()) {
    const body = JSON.parse(request.body);
    if (body.sub_orders) body.sub_orders[0].out_trade_no = 'c'.repeat(32);
    else body.receivers[0].receiver_account = '1900000099';
    const serialized = JSON.stringify(body), options = buildSignedRequest('POST', request.options.path, serialized, config, now);
    await assert.rejects(relayMutation(event({ options, body: serialized }), relayConfig, denied, () => now), { code: 'PAYMENT_RELAY_REJECTED' });
  }
});

test('prepay and close still verify upstream signatures after crossing the relay', async () => {
  const prepay = signed.sign(JSON.stringify({ prepay_id: 'wx_prepay_test' }), now);
  const out = await createPrepay(payment, { ...config, mutationRelay: true, mutationRelayInvoke: invoke(prepay) }, denied, () => now);
  assert.equal(out.prepayId, 'wx_prepay_test');
  const close = { ...signed.sign('', now), statusCode: 204 };
  assert.deepEqual(await closePrepay(payment, { ...config, mutationRelay: true, mutationRelayInvoke: invoke(close) }, denied, () => now), { status: 'QUERY_REQUIRED' });
  await assert.rejects(createPrepay(payment, { ...config, mutationRelay: true,
    mutationRelayInvoke: invoke({ ...prepay, body: Buffer.concat([prepay.body, Buffer.from(' ')]) }) }, denied, () => now), { code: 'PAYMENT_SIGNATURE_INVALID' });
});

test('relayed settlement submission remains PROCESSING, never confirmed distribution', async () => {
  const response = signed.sign(JSON.stringify({ sub_mchid: task.snapshot.subMchid, transaction_id: task.snapshot.transactionId,
    out_order_no: task.taskId, order_id: '30000000000001', status: 'FINISHED',
    receivers: [{ type: 'MERCHANT_ID', receiver_account: config.platformMchid, amount: 2000, result: 'SUCCESS' }] }), now);
  const result = await callSettlement(task, 'SUBMIT', { ...config, mutationRelay: true, mutationRelayInvoke: invoke(response) }, denied, () => now);
  assert.equal(result.status, 'PROCESSING');
});

test('mutation bridge timeout performs one invocation and never retries or accepts a wrong status', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { options, body } = requests()[0];
  let calls = 0;
  const pending = mutateThroughRelay(options, body, () => { calls++; return new Promise(() => {}); });
  const rejected = assert.rejects(pending, { code: 'PAYMENT_RELAY_FAILED' });
  t.mock.timers.tick(12000); await rejected; assert.equal(calls, 1);
  await assert.rejects(mutateThroughRelay(options, body, async () => ({ result: { ok: true,
    data: { statusCode: 204, headers: {}, bodyBase64: '' } } })), { code: 'PAYMENT_RELAY_FAILED' });
});

test('replay denial, uncertain guard outcome and expiration during guard never open HTTPS', async () => {
  const valid = event(requests()[0]);
  for (const consume of [async () => false, async () => undefined, async () => { throw Error('commit reply lost'); }]) {
    await assert.rejects(relayMutation(valid, relayConfig, denied, () => now, consume));
  }
  let time = now;
  await assert.rejects(relayMutation(valid, relayConfig, denied, () => time, async () => { time += 31000; return true; }),
    { code: 'PAYMENT_RELAY_REJECTED' });
});

test('mutation relay allows the guard and HTTP deadlines without the old ten-second cutoff', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { options, body } = requests()[0];
  const pending = mutateThroughRelay(options, body, () => new Promise(resolve => setTimeout(() => resolve({ result: {
    ok: true, data: { statusCode: 200, headers: {}, bodyBase64: '' }
  } }), 11000)));
  t.mock.timers.tick(11000);
  assert.equal((await pending).statusCode, 200);
});
