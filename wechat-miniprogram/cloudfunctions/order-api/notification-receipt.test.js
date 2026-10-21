const { test } = require('node:test');
const assert = require('node:assert/strict');
const { claimNotification, recordNotificationOutcome } = require('./notification-receipt');
const buyer = 'acct_' + 'a'.repeat(32), provider = 'acct_' + 'b'.repeat(32), eventId = 'evt_' + 'c'.repeat(32);
const row = { id: 'ord_' + 'd'.repeat(32), buyer_id: buyer, provider_id: provider, version: 2, stage: 'CONTACTING',
  payload: { events: [{ id: eventId, toStage: 'CONTACTING', createdAt: 1000 }] } };

function store() {
  const records = new Map();
  return { records, async execute(sql, values) {
    if (sql.startsWith('INSERT')) {
      const [key, startedAt] = values;
      if (records.has(key)) throw { code: 'ER_DUP_ENTRY' };
      records.set(key, { status: 'STARTED', updatedAt: startedAt }); return [{ affectedRows: 1 }];
    }
    const [status, now, key] = values, current = records.get(key);
    if (!current || !['STARTED', 'UNKNOWN'].includes(current.status) || current.updatedAt > now) return [{ affectedRows: 0 }];
    Object.assign(current, { status, updatedAt: now }); return [{ affectedRows: 1 }];
  } };
}
test('same event and recipient receives one claim; a different participant has a different claim', async () => {
  const db = store();
  const claims = await Promise.all(Array.from({ length: 12 }, () => claimNotification(db, row, eventId, buyer, 2000)));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.ok(await claimNotification(db, row, eventId, provider, 2000));
});
test('committed INSERT with lost acknowledgement never grants permission or permits a repeated claim', async () => {
  const db = store();
  await assert.rejects(claimNotification({ execute: async (...args) => {
    await db.execute(...args); throw Error('private-database-detail');
  } }, row, eventId, buyer, 2000), { code: 'NOTIFICATION_RECEIPT_UNCONFIRMED' });
  assert.equal(await claimNotification(db, row, eventId, buyer, 3000), null);
});
test('unknown result remains consumed and late acknowledgement cannot be downgraded', async () => {
  const db = store(), candidate = await claimNotification(db, row, eventId, buyer, 2000);
  assert.equal(await recordNotificationOutcome(db, candidate.key, 'UNKNOWN', 3000), true);
  assert.equal(await claimNotification(db, row, eventId, buyer, 4000), null);
  assert.equal(await recordNotificationOutcome(db, candidate.key, 'ACKNOWLEDGED', 5000), true);
  assert.equal(await recordNotificationOutcome(db, candidate.key, 'UNKNOWN', 6000), false);
  assert.equal(db.records.get(candidate.key).status, 'ACKNOWLEDGED');
});
test('invalid recipient or clock cannot write a receipt', async () => {
  let calls = 0; const db = { execute: async () => { calls++; } };
  await assert.rejects(claimNotification(db, row, eventId, 'acct_' + 'f'.repeat(32), 2000));
  await assert.rejects(claimNotification(db, row, eventId, buyer, 999));
  await assert.rejects(recordNotificationOutcome(db, '0'.repeat(64), 'SENT', 2000));
  assert.equal(calls, 0);
});
