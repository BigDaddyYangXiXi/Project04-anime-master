const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildNotificationCandidate: build } = require('./notification-candidate');
const buyer = 'acct_' + 'a'.repeat(32), provider = 'acct_' + 'b'.repeat(32);
const eventId = 'evt_' + 'c'.repeat(32);
function order() {
  return { id: 'ord_' + 'd'.repeat(32), buyer_id: buyer, provider_id: provider, version: 2, stage: 'CONTACTING',
    payload: { public: { requirement: 'private-sentinel', location: 'private-sentinel', referenceImages: ['private-sentinel'] },
      events: [{ id: eventId, toStage: 'CONTACTING', createdAt: 1000, detail: 'private-sentinel' }],
      contact: 'private-sentinel' } };
}
test('only persisted latest events for order participants produce minimal stable candidates', () => {
  const row = order(), a = build(row, eventId, buyer), b = build(row, eventId, provider);
  assert.equal(a.key, build({ ...row, payload: JSON.stringify(row.payload) }, eventId, buyer).key);
  assert.deepEqual(build({ ...row, version: '2' }, eventId, buyer), a);
  assert.throws(() => build({ ...row, version: '9007199254740993' }, eventId, buyer), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
  assert.notEqual(a.key, b.key);
  assert.equal(JSON.stringify(a).includes('private-sentinel'), false);
  assert.equal(a.recipientRole, 'BUYER'); assert.equal(b.recipientRole, 'PROVIDER');
  assert.deepEqual(Object.keys(a).sort(), ['key', 'orderId', 'eventId', 'recipientAccountId', 'recipientRole', 'orderVersion', 'stage', 'occurredAt'].sort());
});
test('outsiders and invented event ids cannot create candidates', () => {
  assert.throws(() => build(order(), eventId, 'acct_' + 'e'.repeat(32)), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
  assert.throws(() => build(order(), 'evt_' + 'f'.repeat(32), buyer), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
});
test('obsolete events and inconsistent current stages are rejected', () => {
  const row = order(); row.payload.events.push({ id: 'evt_' + 'f'.repeat(32), toStage: 'CONTACTING', createdAt: 2000 });
  assert.throws(() => build(row, eventId, buyer), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
  const changed = order(); changed.stage = 'DECLINED';
  assert.throws(() => build(changed, eventId, buyer), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
});
test('malformed persisted records fail closed without exposing their contents', () => {
  for (const payload of ['private-sentinel', null, {}, { events: [null] }]) {
    assert.throws(() => build({ ...order(), payload }, eventId, buyer), error => {
      assert.equal(error.code, 'NOTIFICATION_CANDIDATE_INVALID');
      assert.equal(error.message.includes('private-sentinel'), false); return true;
    });
  }
});
