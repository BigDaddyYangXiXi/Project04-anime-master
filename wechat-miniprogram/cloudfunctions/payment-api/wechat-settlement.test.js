const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createNotificationFixture } = require('./test-notification-fixture');
const { createQueryFixture } = require('./test-query-fixture');
const { buildSettlementRequest, verifySettlementResponse, callSettlement } = require('./wechat-settlement');
const { relayQuery } = require('./query-relay');
const signed = createNotificationFixture(), transport = createQueryFixture(signed.config);
const now = 1790000000000;
const config = { ...transport.config, appid: 'wx_test', platformReceiverName: '测试平台有限公司', settlementEnabled: true };
const task = { taskId: 'a'.repeat(32), snapshot: { transactionId: '420000000000001', appid: config.appid,
  platformMchid: config.platformMchid, subMchid: '1900000002', platformFeeFen: 100, totalFen: 1000 } };
function result(overrides = {}) {
  return { sub_mchid: task.snapshot.subMchid, transaction_id: task.snapshot.transactionId,
    out_order_no: task.taskId, order_id: '30000000000001', status: 'FINISHED',
    receivers: [{ type: 'MERCHANT_ID', receiver_account: config.platformMchid, amount: 100,
      result: 'SUCCESS', detail_id: '360000000000001', finish_time: '2026-09-21T12:00:00+08:00' }], ...overrides };
}
function response(data) { return signed.sign(JSON.stringify(data), now); }

test('split settlement query verifies signed fee result and rejects altered or mismatched replies', async () => {
  const relayConfig = { enabled: true, platformMchid: config.platformMchid, merchantSerial: config.merchantSerial,
    wechatPublicKeyId: config.wechatPublicKeyId, merchantPublicKey: transport.publicKey.export({ type: 'spki', format: 'pem' }) };
  const direct = () => assert.fail('private query must use the relay');
  const invoke = data => async event => ({ result: { ok: true,
    data: await relayQuery(event, relayConfig, transport.requestFor(data), () => now) } });
  const valid = response(result());
  const out = await callSettlement(task, 'QUERY', { ...config, queryRelay: true, queryRelayInvoke: invoke(valid) }, direct, () => now);
  assert.equal(out.status, 'FEE_SUCCEEDED');
  assert.equal(out.platformFeeFen, 100);
  await assert.rejects(callSettlement(task, 'QUERY', { ...config, queryRelay: true,
    queryRelayInvoke: invoke({ ...valid, body: Buffer.concat([valid.body, Buffer.from(' ')]) }) }, direct, () => now),
  { code: 'PAYMENT_SIGNATURE_INVALID' });
  const wrong = result(); wrong.receivers[0].amount = 101;
  await assert.rejects(callSettlement(task, 'QUERY', { ...config, queryRelay: true,
    queryRelayInvoke: invoke(response(wrong)) }, direct, () => now), { code: 'SETTLEMENT_RESPONSE_INVALID' });
});

test('relay settlement query signature binds every parameter and refuses extra query fields', async () => {
  const relayConfig = { enabled: true, platformMchid: config.platformMchid, merchantSerial: config.merchantSerial,
    wechatPublicKeyId: config.wechatPublicKeyId, merchantPublicKey: transport.publicKey.export({ type: 'spki', format: 'pem' }) };
  const { options } = buildSettlementRequest(task, 'QUERY', config, now);
  for (const path of [options.path.replace('1900000002', '1900000003'),
    options.path.replace(task.taskId, 'b'.repeat(32)), `${options.path}&extra=1`, options.path.replace('420000000000001', '420000000000002')]) {
    await assert.rejects(relayQuery({ path, authorization: options.headers.Authorization }, relayConfig,
      () => assert.fail('must not call WeChat'), () => now), { code: 'PAYMENT_RELAY_REJECTED' });
  }
});

test('enabling the read-only relay cannot send settlement POST through it', async () => {
  let directCalls = 0;
  const actualRequest = transport.requestFor(response(result()), () => { directCalls++; });
  const output = await callSettlement(task, 'SUBMIT', { ...config, queryRelay: true,
    queryRelayInvoke: () => assert.fail('read-only relay must never receive POST') }, actualRequest, () => now);
  assert.equal(output.status, 'PROCESSING');
  assert.equal(directCalls, 1);
});

test('settlement POST signs exact body and encrypts the merchant name with RSA OAEP', () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keys = new Map([[config.wechatPublicKeyId, pair.publicKey]]);
  const { options, body } = buildSettlementRequest(task, 'SUBMIT', { ...config, publicKeys: keys }, now);
  assert.equal(options.hostname, 'api.mch.weixin.qq.com');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Length'], Buffer.byteLength(body));
  const data = JSON.parse(body);
  assert.equal(data.finish, true);
  assert.equal(data.receivers[0].receiver_account, config.platformMchid);
  assert.equal(data.receivers[0].amount, 100);
  assert.equal(body.includes(config.platformReceiverName), false);
  assert.equal(crypto.privateDecrypt({ key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
    Buffer.from(data.receivers[0].receiver_name, 'base64')).toString(), config.platformReceiverName);
  const auth = Object.fromEntries([...options.headers.Authorization.matchAll(/(\w+)="([^"]+)"/g)].map(match => [match[1], match[2]]));
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`POST\n${options.path}\n${auth.timestamp}\n${auth.nonce_str}\n${body}\n`),
    transport.publicKey, Buffer.from(auth.signature, 'base64')), true);
});

test('query binds the original submerchant, transaction and task id with an empty body', () => {
  const { options, body } = buildSettlementRequest(task, 'QUERY', config, now);
  assert.equal(body, '');
  assert.equal(options.path, `/v3/ecommerce/profitsharing/orders?sub_mchid=1900000002&transaction_id=420000000000001&out_order_no=${task.taskId}`);
  assert.equal(options.method, 'GET');
});

test('POST success remains processing; signed query confirms only the platform fee, not bank arrival', () => {
  assert.equal(verifySettlementResponse(response(result()), task, 'SUBMIT', config, now).status, 'PROCESSING');
  const verified = verifySettlementResponse(response(result()), task, 'QUERY', config, now);
  assert.equal(verified.status, 'FEE_SUCCEEDED');
  assert.equal(verified.finishAmountFen, null);
  assert.equal(verified.platformFeeFen, 100);
  const data = result(); data.receivers[0].result = 'CLOSED'; data.receivers[0].fail_reason = 'NO_AUTH';
  assert.equal(verifySettlementResponse(response(data), task, 'QUERY', config, now).status, 'CLOSED');
});

test('unknown or inconsistent channel outcomes never turn into fee success', () => {
  for (const mutate of [data => { data.out_order_no = 'other'; }, data => { data.sub_mchid = 'other'; },
    data => { data.transaction_id = 'other'; }, data => { data.receivers[0].amount = 99; },
    data => { data.receivers[0].receiver_account = 'other'; }, data => { data.receivers.push(data.receivers[0]); },
    data => { data.status = 'UNKNOWN'; }, data => { data.receivers[0].result = 'PENDING'; },
    data => { data.receivers[0].finish_time = 'invalid'; }, data => { data.receivers[0].finish_time = '2026-02-30T12:00:00Z'; },
    data => { data.finish_amount = -1; }]) {
    const data = result(); mutate(data);
    assert.throws(() => verifySettlementResponse(response(data), task, 'QUERY', config, now), { code: 'SETTLEMENT_RESPONSE_INVALID' });
  }
});

test('signed not-found is distinct from transport failure or unsigned 404', () => {
  const missing = response({ code: 'RESOURCE_NOT_EXISTS' }); missing.statusCode = 404;
  assert.deepEqual(verifySettlementResponse(missing, task, 'QUERY', config, now), { status: 'NOT_FOUND' });
  assert.throws(() => verifySettlementResponse({ ...missing, headers: {} }, task, 'QUERY', config, now));
  assert.throws(() => verifySettlementResponse(missing, task, 'SUBMIT', config, now));
});

test('transport verifies original bytes and disabled settlement cannot open a connection', async () => {
  let called = false;
  await assert.rejects(callSettlement(task, 'SUBMIT', { ...config, settlementEnabled: false }, () => { called = true; }),
    { code: 'SETTLEMENT_NOT_ENABLED' });
  assert.equal(called, false);
  const valid = response(result());
  assert.equal((await callSettlement(task, 'QUERY', config, transport.requestFor(valid), () => now)).status, 'FEE_SUCCEEDED');
  const tampered = { ...valid, body: Buffer.concat([valid.body, Buffer.from(' ')]) };
  await assert.rejects(callSettlement(task, 'QUERY', config, transport.requestFor(tampered), () => now));
});

test('invalid merchant binding, receiver configuration and request action are blocked before sending', () => {
  assert.throws(() => buildSettlementRequest(task, 'SUBMIT', { ...config, platformReceiverName: '' }, now));
  assert.throws(() => buildSettlementRequest(task, 'QUERY', { ...config, appid: 'other' }, now));
  assert.throws(() => buildSettlementRequest(task, 'DELETE', config, now));
  assert.throws(() => buildSettlementRequest({ ...task, snapshot: { ...task.snapshot, platformFeeFen: 1001 } }, 'SUBMIT', config, now));
});
