const test = require('node:test');
const assert = require('node:assert/strict');
const { envelope, verify } = require('./notification-rpc');
const { handle: handlePublic } = require('./notification-public');
const { sendWithWx } = require('./notification-public');
const { handle: handlePrivate } = require('./notification-private');
const secret = 'a'.repeat(64);
const request = { orderId: 'ord_' + 'b'.repeat(32), eventId: 'evt_' + 'c'.repeat(32), recipientAccountId: 'acct_' + 'd'.repeat(32) };

test('signatures bind exact operation and body and reject forged, stale or oversized calls', () => {
  const good = envelope('claim', request, secret, 1000);
  assert.deepEqual(verify(good, ['claim'], secret, 2000), { action: 'claim', payload: request });
  for (const value of [{ ...good, body: good.body + ' ' }, { ...good, signature: '0'.repeat(64) },
    { ...good, timestamp: 999 }, { ...good, extra: true }, { ...good, body: 'x'.repeat(4097) }]) {
    assert.throws(() => verify(value, ['claim'], secret, 2000), { code: 'NOTIFICATION_CALL_REJECTED' });
  }
  assert.throws(() => verify(good, ['dispatch'], secret, 2000));
  assert.throws(() => verify(good, ['claim'], secret, 40000));
  assert.throws(() => verify(good, ['claim'], 'invalid', 2000));
});

test('private entry authenticates before opening any database connection', async () => {
  let opened = 0;
  await assert.rejects(handlePrivate({ action: 'claim', payload: request }, secret, () => { opened++; }));
  await assert.rejects(handlePrivate(envelope('dispatch', request, secret), secret, () => { opened++; }));
  assert.equal(opened, 0);
});

test('public-to-private protocol sends once and a repeated trigger cannot send again', async () => {
  let claimed = false, sent = 0; const operations = [];
  const candidate = { ...request, key: 'f'.repeat(64), recipientOpenId: 'test_openid', recipientRole: 'PROVIDER',
    stage: 'CONTACTING', orderVersion: 2, occurredAt: 1000 };
  const invoke = async signed => {
    const { action, payload } = verify(signed, ['claim', 'recheck', 'record'], secret);
    operations.push(action);
    if (action === 'claim') { const data = claimed ? null : candidate; claimed = true; return { result: { ok: true, data } }; }
    if (action === 'record') assert.deepEqual(payload, { key: candidate.key, status: 'ACKNOWLEDGED' });
    return { result: { ok: true, data: true } };
  };
  const send = async message => { sent++; assert.equal(message.page, `pages/provider-request/index?id=${request.orderId}`); return { errcode: 0 }; };
  const trigger = envelope('dispatch', request, secret);
  assert.deepEqual(await handlePublic(trigger, secret, 'trial', invoke, send), { status: 'ACKNOWLEDGED', recorded: true });
  assert.deepEqual(await handlePublic(trigger, secret, 'trial', invoke, send), { status: 'DUPLICATE' });
  assert.equal(sent, 1); assert.deepEqual(operations, ['claim', 'recheck', 'record', 'claim']);
});

test('missing private acknowledgement and unsigned public calls never reach WeChat', async () => {
  let sent = 0;
  const send = async () => { sent++; };
  await assert.rejects(handlePublic(envelope('dispatch', request, secret), secret, 'trial', async () => ({ result: { ok: false } }), send));
  await assert.rejects(handlePublic({ action: 'dispatch', payload: request }, secret, 'trial', async () => { throw Error('must not invoke'); }, send));
  assert.equal(sent, 0);
});

test('SDK camelCase success and thrown WeChat rejection normalize without treating absent codes as success', async () => {
  const sdk = send => ({ openapi: { subscribeMessage: { send } } });
  assert.deepEqual(await sendWithWx(sdk(async () => ({ errCode: 0 })), {}), { errcode: 0 });
  assert.deepEqual(await sendWithWx(sdk(async () => { throw { errCode: 43101 }; }), {}), { errcode: 43101 });
  assert.deepEqual(await sendWithWx(sdk(async () => ({})), {}), { errcode: undefined });
  await assert.rejects(sendWithWx(sdk(async () => { throw Error('private network'); }), {}), { message: 'NOTIFICATION_CHANNEL_UNCONFIRMED' });
  await assert.rejects(sendWithWx(sdk(async () => { throw { errCode: 0 }; }), {}), { message: 'NOTIFICATION_CHANNEL_UNCONFIRMED' });
});

test('closed public entry permits only authenticated read-through without loading the WeChat sending SDK', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  let calls = 0;
  const sandbox = { exports: {}, process: { env: { SCF_NAMESPACE: 'cloudbase-d2g65rqbvee0bd978',
    NOTIFICATION_SEND_ENABLED: 'false', NOTIFICATION_RELAY_KEY: secret } }, require(name) {
    if (name === './notification-rpc') return require('./notification-rpc');
    if (name === './notification-dispatch') return require('./notification-dispatch');
    assert.equal(name, '@cloudbase/node-sdk', 'read-only path must not load WeChat SDK');
    return { init(config) { assert.equal(config.retries, 0); return { async callFunction(value) {
      calls++; assert.equal(value.name, 'order-notification-private');
      assert.equal(verify(value.data, ['recheck'], secret).action, 'recheck');
      return { result: { ok: true, data: false } };
    } }; } };
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/notification-public.js`, 'utf8'), sandbox);
  const read = await sandbox.exports.main(envelope('recheck', {}, secret));
  assert.equal(read.ok, true); assert.equal(read.data, false); assert.equal(calls, 1);
  const closed = await sandbox.exports.main(envelope('dispatch', request, secret));
  assert.equal(closed.ok, false); assert.equal(calls, 1);
  const unsigned = await sandbox.exports.main({ action: 'recheck', payload: {} });
  assert.equal(unsigned.ok, false); assert.equal(calls, 1);
});
