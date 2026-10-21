const test = require('node:test');
const assert = require('node:assert/strict');
const { envelope, handle, confirmThroughRelay } = require('./slot-relay');
const secret = Buffer.alloc(32, 7).toString('base64');
const row = { id: 'order_1', version: 1, stage: 'CONTACTING' };
const next = { version: 2, stage: 'BUYER_FINAL_CONFIRM', payload: '{"private":"内容"}' };
const now = 1790190000000;
const denied = () => assert.fail('Unauthorized request reached persistence');

test('slot entry ignores SDK metadata but still requires the exact signed request', async () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  let writes = 0;
  const sandbox = { exports: {}, Buffer, process: { env: { SCF_NAMESPACE: 'cloudbase-d2g65rqbvee0bd978', ORDER_SLOT_RELAY_KEY: secret } },
    require(name) {
      if (name === './slot-runtime') return async () => { writes++; };
      assert.equal(name, 'node:crypto', 'private handler must not load outbound SDKs');
      return require(name);
    } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/slot-relay.js`, 'utf8'), sandbox);
  const signed = envelope(row, next, secret);
  const event = { ...signed, userInfo: { openId: 'untrusted' }, tcbContext: { administrator: true } };
  assert.equal((await sandbox.exports.main(event)).ok, true);
  for (const invalid of [{ ...event, body: signed.body + ' ' }, { ...event, extra: true },
    { userInfo: event.userInfo, tcbContext: event.tcbContext }]) {
    assert.equal((await sandbox.exports.main(invalid)).ok, false);
  }
  assert.equal(writes, 1);
});

test('slot relay binds the exact server transition and preserves payload bytes', async () => {
  let saved;
  assert.deepEqual(await handle(envelope(row, next, secret, now), secret, async (r, n) => { saved = { row: r, next: n }; }, now), { ok: true });
  assert.deepEqual(saved, { row, next });
});
test('forged, expired, malformed and oversized requests never reach the database', async () => {
  const valid = envelope(row, next, secret, now);
  for (const event of [null, {}, { ...valid, body: valid.body.replace('CONTACTING', 'COMPLETED') },
    { ...valid, timestamp: now + 1 }, { ...valid, signature: '0'.repeat(64) },
    { ...valid, target: 'other-function' }, { ...valid, body: 'x'.repeat(524289) }]) {
    await assert.rejects(handle(event, secret, denied, now), { code: 'SLOT_STORE_NOT_CONFIGURED' });
  }
  for (const time of [now - 30001, now + 30001]) {
    await assert.rejects(handle(valid, secret, denied, time), { code: 'SLOT_STORE_NOT_CONFIGURED' });
  }
  for (const wrongKey of ['', 'invalid', Buffer.alloc(32, 8).toString('base64')]) {
    await assert.rejects(handle(valid, wrongKey, denied, now), { code: 'SLOT_STORE_NOT_CONFIGURED' });
  }
});
test('replay reaches the existing version check and never produces a second successful transition', async () => {
  let version = 1, writes = 0;
  const persist = async (r, n) => {
    if (r.version !== version) throw Object.assign(Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' });
    version = n.version; writes++;
  };
  const event = envelope(row, next, secret, now);
  await handle(event, secret, persist, now);
  await assert.rejects(handle(event, secret, persist, now), { code: 'VERSION_CONFLICT' });
  assert.equal(writes, 1);
});
test('client invokes once, preserves business rejections and redacts transport errors', async () => {
  let calls = 0;
  await confirmThroughRelay(row, next, secret, async event => {
    calls++; return { result: await handle(event, secret, async () => {}) };
  });
  assert.equal(calls, 1);
  for (const code of ['SCHEDULE_CONFLICT', 'VERSION_CONFLICT']) {
    await assert.rejects(confirmThroughRelay(row, next, secret, async () => ({ result: { ok: false, code } })), { code });
  }
  calls = 0;
  await assert.rejects(confirmThroughRelay(row, next, secret, async () => {
    calls++; throw Error('private transport detail');
  }), { message: 'SLOT_STORE_NOT_CONFIGURED' });
  assert.equal(calls, 1);
  await assert.rejects(confirmThroughRelay(row, next, secret, async () => ({ result: { ok: false, code: 'PRIVATE_SQL' } })), { code: 'SLOT_STORE_NOT_CONFIGURED' });
});
