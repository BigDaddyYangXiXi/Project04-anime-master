const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrepayRequest } = require('./wechat-prepay');
const { buildCloseRequest } = require('./wechat-close');
const { buildQueryRequest } = require('./wechat-query');
const { normalizeDirect } = require('./direct-receipt');
const { createNotificationFixture } = require('./test-notification-fixture');
const { createQueryFixture } = require('./test-query-fixture');
const { decryptNotification } = require('./wechat-verification');
const { relayMutation } = require('./mutation-relay');
const { relayQuery } = require('./query-relay');
const { consumeMutation } = require('./mutation-replay-guard');
const fixture = createNotificationFixture();
const transport = createQueryFixture(fixture.config);
const now = 1790179200000;
const config = { ...transport.config, appid: 'wx_test', paymentMode: 'DIRECT', prepayEnabled: true,
  closeEnabled: true, notifyUrl: 'https://example.test/payment' };
const payment = { id: 'a'.repeat(32), payment_mode: 'DIRECT', appid: config.appid, platform_mchid: config.platformMchid,
  sub_mchid: null, payer_openid: 'payer', amount_fen: '10000', currency: 'CNY', status: 'CREATED' };
const receipt = () => ({ appid: config.appid, mchid: config.platformMchid, out_trade_no: payment.id,
  transaction_id: 'wx_transaction', trade_type: 'JSAPI', trade_state: 'SUCCESS', payer: { openid: 'payer' },
  success_time: new Date(now).toISOString(), amount: { total: 10000, payer_total: 9900, currency: 'CNY', payer_currency: 'CNY' } });

test('company direct prepay uses company merchant, exact gross amount and trusted payer without a submerchant or sharing flag', () => {
  const request = buildPrepayRequest(payment, config, now);
  assert.equal(request.options.path, '/v3/pay/transactions/jsapi');
  assert.deepEqual(JSON.parse(request.body), { appid: config.appid, mchid: config.platformMchid,
    out_trade_no: payment.id, description: '万匠屋-服务订单', notify_url: config.notifyUrl,
    amount: { total: 10000, currency: 'CNY' }, payer: { openid: 'payer' } });
  for (const changed of [{ payment_mode: 'OTHER' }, { sub_mchid: config.platformMchid }, { amount_fen: 0 }, { appid: 'another' }]) {
    assert.throws(() => buildPrepayRequest({ ...payment, ...changed }, config, now));
  }
  assert.throws(() => buildPrepayRequest(payment, { ...config, paymentMode: 'COMBINE' }, now));
});
test('queries and closes retain original direct channel even when new payment configuration changes', () => {
  const changed = { ...config, paymentMode: 'COMBINE' };
  assert.equal(buildQueryRequest(payment.id, changed, now, 'DIRECT').path,
    `/v3/pay/transactions/out-trade-no/${payment.id}?mchid=${config.platformMchid}`);
  const close = buildCloseRequest(payment, changed, now);
  assert.equal(close.options.path, `/v3/pay/transactions/out-trade-no/${payment.id}/close`);
  assert.deepEqual(JSON.parse(close.body), { mchid: config.platformMchid });
});
test('signed encrypted direct receipt preserves actual discounted payer amount and direct identity', () => {
  const raw = fixture.notify(receipt(), now);
  const normalized = normalizeDirect(decryptNotification(raw.body, raw.headers, fixture.config, now).transaction, true);
  assert.equal(normalized.paymentMode, 'DIRECT'); assert.equal(normalized.subMchid, null);
  assert.equal(normalized.totalFen, 10000); assert.equal(normalized.payerPaidFen, 9900);
  assert.equal(normalized.payerOpenid, 'payer'); assert.equal(normalized.paidAt, now);
  assert.throws(() => decryptNotification(Buffer.concat([raw.body, Buffer.from(' ')]), raw.headers, fixture.config, now));
});
test('direct success rejects missing identity, invalid money, mixed channel and invalid calendar dates', () => {
  for (const patch of [{ payer: {} }, { mchid: '' }, { appid: '' }, { sub_orders: [] }, { trade_type: 'APP' },
    { success_time: '2026-02-30T12:00:00+08:00' }, { amount: { ...receipt().amount, payer_total: 10001 } },
    { amount: { ...receipt().amount, payer_currency: 'USD' } }]) assert.throws(() => normalizeDirect({ ...receipt(), ...patch }));
  assert.equal(normalizeDirect({ ...receipt(), payer: undefined, trade_state: 'NOTPAY' }).payerOpenid, undefined);
  assert.throws(() => normalizeDirect({ ...receipt(), trade_state: 'NOTPAY' }, true));
});

test('direct prepay, close and query cross the signed relay with replay protection and exact merchant binding', async () => {
  const relayConfig = { enabled: true, mutationsEnabled: true, appid: config.appid, notifyUrl: config.notifyUrl,
    platformMchid: config.platformMchid, merchantSerial: config.merchantSerial, wechatPublicKeyId: config.wechatPublicKeyId,
    merchantPublicKey: transport.publicKey.export({ type: 'spki', format: 'pem' }) };
  for (const request of [buildPrepayRequest(payment, config, now), buildCloseRequest(payment, config, now)]) {
    const event = { path: request.options.path, body: request.body, authorization: request.options.headers.Authorization };
    const consumed = new Set();
    const guard = { async execute(sql, [hash]) {
      if (consumed.has(hash)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      consumed.add(hash); return [{ affectedRows: 1 }];
    } };
    let calls = 0;
    const statusCode = event.path.endsWith('/close') ? 204 : 200;
    const network = transport.requestFor({ statusCode, body: Buffer.from('') }, () => calls++);
    const consume = e => consumeMutation(guard, e, relayConfig, () => now);
    assert.equal((await relayMutation(event, relayConfig, network, () => now, consume)).statusCode, statusCode);
    await assert.rejects(relayMutation(event, relayConfig, network, () => now, consume));
    assert.equal(calls, 1);
    await assert.rejects(relayMutation({ ...event, body: event.body + ' ' }, relayConfig, network, () => now, consume));
    assert.equal(calls, 1);
  }
  const request = buildQueryRequest(payment.id, config, now, 'DIRECT');
  const event = { path: request.path, authorization: request.headers.Authorization };
  assert.equal((await relayQuery(event, relayConfig, transport.requestFor({ statusCode: 200, body: Buffer.from('{}') }), () => now)).statusCode, 200);
  await assert.rejects(relayQuery({ ...event, path: event.path.replace(config.platformMchid, '123') }, relayConfig,
    () => assert.fail('foreign merchant reached network'), () => now));
});
