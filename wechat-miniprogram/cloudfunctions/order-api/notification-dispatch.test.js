const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatchNotification: dispatch } = require('./notification-dispatch');
const candidate = { key: 'a'.repeat(64), orderId: 'ord_' + 'b'.repeat(32), recipientRole: 'BUYER',
  recipientOpenId: 'private_openid', stage: 'CONTACTING' };
const request = { orderId: candidate.orderId, eventId: 'evt_' + 'c'.repeat(32), recipientAccountId: 'acct_' + 'd'.repeat(32) };

function channel(overrides = {}) {
  const calls = [];
  return { calls, adapters: {
    async claim(value) { calls.push('claim'); assert.deepEqual(value, request); return candidate; },
    async recheck(value) { calls.push('recheck'); assert.equal(value, candidate); return true; },
    async send(message) { calls.push('send'); assert.equal(message.touser, candidate.recipientOpenId); return { errcode: 0 }; },
    async record(key, status) { calls.push('record:' + status); assert.equal(key, candidate.key); return true; },
    ...overrides
  } };
}

test('channel is invoked only after durable claim and eligibility recheck, then records acceptance', async () => {
  const c = channel();
  assert.deepEqual(await dispatch(request, 'trial', c.adapters), { status: 'ACKNOWLEDGED', recorded: true });
  assert.deepEqual(c.calls, ['claim', 'recheck', 'send', 'record:ACKNOWLEDGED']);
});

test('duplicate or uncertain claim cannot invoke the channel', async () => {
  const duplicate = channel({ async claim() { return null; } });
  assert.deepEqual(await dispatch(request, 'trial', duplicate.adapters), { status: 'DUPLICATE' });
  assert.deepEqual(duplicate.calls, []);
  const failed = channel({ async claim() { throw Error('claim unavailable'); } });
  await assert.rejects(dispatch(request, 'trial', failed.adapters)); assert.deepEqual(failed.calls, []);
});

test('cancellation, changed order and failed rechecks never send', async () => {
  for (const value of [false, undefined, { eligible: true }]) {
    const c = channel({ async recheck() { return value; } });
    assert.deepEqual(await dispatch(request, 'trial', c.adapters), { status: 'REJECTED', recorded: true });
    assert.equal(c.calls.includes('send'), false);
  }
  const c = channel({ async recheck() { throw Error('database failed'); } });
  assert.deepEqual(await dispatch(request, 'trial', c.adapters), { status: 'UNKNOWN', recorded: true });
  assert.equal(c.calls.includes('send'), false);
});

test('lost channel response is unknown and is never retried, even when saving the outcome fails', async () => {
  let sends = 0;
  const c = channel({ async send() { sends++; throw Error('private network detail'); }, async record() { throw Error('private database detail'); } });
  const result = await dispatch(request, 'trial', c.adapters);
  assert.deepEqual(result, { status: 'UNKNOWN', recorded: false }); assert.equal(sends, 1);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('a definitive rejection remains rejected and a missing persistence acknowledgement is visible', async () => {
  const c = channel({ async send() { return { errcode: 43101 }; }, async record() { return false; } });
  assert.deepEqual(await dispatch(request, 'trial', c.adapters), { status: 'REJECTED', recorded: false });
  const invalid = channel();
  await assert.rejects(dispatch(request, undefined, invalid.adapters), { code: 'NOTIFICATION_MESSAGE_INVALID' });
  assert.deepEqual(invalid.calls, []);
});
