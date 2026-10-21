// Explicit isolated localhost database. No application/cloud configuration is read.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// Test the exact staged code and dependency tree as well as the source tree.
const notificationRoot = process.env.NOTIFICATION_TEST_DEPLOYMENT_BUNDLE === 'true'
  ? '../.artifacts/company-notification-functions/order-notification-private'
  : '../cloudfunctions/order-api';
const mysql = require(notificationRoot + '/node_modules/mysql2/promise');
const { claimNotification, recordNotificationOutcome } = require(notificationRoot + '/notification-receipt');
const { claimPersistedNotification } = require(notificationRoot + '/notification-claim');
const { recheckNotification } = require(notificationRoot + '/notification-recheck');
const { listNotificationRecovery } = require(notificationRoot + '/notification-recovery');
const { normalizeSubscriptionEvents } = require('../cloudfunctions/wechat-message-callback/subscription-events');
const { TEMPLATE_ID } = require('../miniprogram/services/order-subscription');
const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('EXPLICIT_LOCAL_TEST_PORT_REQUIRED');
const database = 'anime_notification_test_' + crypto.randomBytes(8).toString('hex');
const config = { host: '127.0.0.1', port, user: 'root', password: process.env.PAYMENT_TEST_MYSQL_PASSWORD || '' };
let admin, pool;
async function subscription(openid, status = 'accept', seconds = 1) {
  const [value] = normalizeSubscriptionEvents({ MsgType: 'event', Event: 'subscribe_msg_popup_event',
    FromUserName: openid, CreateTime: seconds, List: { TemplateId: TEMPLATE_ID, SubscribeStatusString: status } });
  await pool.execute(`INSERT INTO wechat_subscription_events
    (event_key,recipient_key,template_id,event_type,status,occurred_at) VALUES(?,?,?,?,?,?)`,
  [value.event_key, value.recipient_key, value.template_id, value.event_type, value.status, value.occurred_at]);
}
const buyer = 'acct_' + 'a'.repeat(32), eventId = 'evt_' + 'c'.repeat(32);
const row = { id: 'ord_' + 'd'.repeat(32), buyer_id: buyer, provider_id: 'acct_' + 'b'.repeat(32), version: 2,
  stage: 'CONTACTING', payload: { events: [{ id: eventId, toStage: 'CONTACTING', createdAt: 1000 }] } };
before(async () => {
  admin = await mysql.createConnection(config);
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ ...config, database, connectionLimit: 12 });
  for (const file of ['0001_identity_core.sql', '0006_order_aggregates.sql', '0031_order_notification_receipts.sql', '0032_wechat_subscription_events.sql']) {
    for (const sql of fs.readFileSync(path.join(__dirname, '../database/mysql', file), 'utf8').split(';').filter(value => value.trim())) await pool.query(sql);
  }
});
beforeEach(async () => {
  await pool.query('DELETE FROM wechat_subscription_events');
  await pool.query('DELETE FROM order_notification_receipts');
  await pool.query('DELETE FROM order_aggregates');
  await pool.query('DELETE FROM accounts');
  for (const id of [buyer, row.provider_id]) {
    await pool.execute('INSERT INTO accounts(id,uid,nickname,created_at,updated_at) VALUES(?,?,?,1,1)', [id, id, 'TEST']);
    await pool.execute('INSERT INTO wechat_identities(account_id,open_id,created_at,updated_at) VALUES(?,?,1,1)', [id, 'openid-' + id]);
    await subscription('openid-' + id);
  }
  await pool.execute(`INSERT INTO order_aggregates(id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,version,created_at,updated_at)
    VALUES(?,?,?,'test-request',?,?,?,2,1000,1000)`, [row.id, buyer, row.provider_id, '0'.repeat(64), row.stage, JSON.stringify(row.payload)]);
});

test('subscription observation schema preserves distinct refusals and rejects invalid states', async () => {
  const { normalizeSubscriptionEvents } = require('../cloudfunctions/wechat-message-callback/subscription-events');
  const { TEMPLATE_ID } = require('../miniprogram/services/order-subscription');
  const source = { MsgType: 'event', Event: 'subscribe_msg_popup_event', FromUserName: 'test-user',
    CreateTime: '1620973045', List: { TemplateId: TEMPLATE_ID, SubscribeStatusString: 'accept' } };
  const [accepted] = normalizeSubscriptionEvents(source);
  const [rejected] = normalizeSubscriptionEvents({ ...source, Event: 'subscribe_msg_change_event',
    List: { ...source.List, SubscribeStatusString: 'reject' } });
  const insert = value => pool.execute(`INSERT INTO wechat_subscription_events
    (event_key,recipient_key,template_id,event_type,status,occurred_at) VALUES(?,?,?,?,?,?)`,
  [value.event_key, value.recipient_key, value.template_id, value.event_type, value.status, value.occurred_at]);
  await insert(rejected); await insert(accepted);
  await assert.rejects(insert(accepted), { code: 'ER_DUP_ENTRY' });
  const [[latest]] = await pool.execute(`SELECT status FROM wechat_subscription_events
    WHERE recipient_key=? AND template_id=? ORDER BY occurred_at DESC,(status='REJECT') DESC LIMIT 1`,
  [accepted.recipient_key, TEMPLATE_ID]);
  assert.equal(latest.status, 'REJECT');
  for (const invalid of [{ event_type: 'OTHER' }, { status: 'UNKNOWN' }, { event_type: 'CHANGE', status: 'ACCEPT' }, { occurred_at: 0 }]) {
    await assert.rejects(insert({ ...accepted, event_key: 'f'.repeat(64), ...invalid }), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  }
});
after(async () => {
  if (pool) await pool.end();
  if (admin) { try { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); } finally { await admin.end(); } }
});
test('real concurrent inserts grant one permission and fresh connections still reject repeats', async () => {
  const values = await Promise.all(Array.from({ length: 20 }, () => claimNotification(pool, row, eventId, buyer, 2000)));
  assert.equal(values.filter(Boolean).length, 1);
  const fresh = await mysql.createConnection({ ...config, database });
  try { assert.equal(await claimNotification(fresh, row, eventId, buyer, 3000), null); }
  finally { await fresh.end(); }
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM order_notification_receipts');
  assert.equal(count.n, 1);
});
test('committed but unacknowledged insertion remains consumed in the real database', async () => {
  await assert.rejects(claimNotification({ execute: async (...args) => {
    await pool.execute(...args); throw Error('connection lost after commit');
  } }, row, eventId, buyer, 2000), { code: 'NOTIFICATION_RECEIPT_UNCONFIRMED' });
  assert.equal(await claimNotification(pool, row, eventId, buyer, 3000), null);
});
test('unknown state resolves once and definitive acknowledgement cannot be downgraded', async () => {
  const candidate = await claimNotification(pool, row, eventId, buyer, 2000);
  assert.equal(await recordNotificationOutcome(pool, candidate.key, 'UNKNOWN', 3000), true);
  assert.equal(await recordNotificationOutcome(pool, candidate.key, 'ACKNOWLEDGED', 2999), false);
  assert.equal(await recordNotificationOutcome(pool, candidate.key, 'ACKNOWLEDGED', 4000), true);
  assert.equal(await recordNotificationOutcome(pool, candidate.key, 'REJECTED', 5000), false);
  const [[saved]] = await pool.query('SELECT status,updated_at FROM order_notification_receipts');
  assert.equal(saved.status, 'ACKNOWLEDGED'); assert.equal(saved.updated_at, 4000);
});
test('database enforces receipt state and timestamp constraints', async () => {
  for (const [status, started, updated] of [['INVALID', 1, 1], ['STARTED', 0, 1], ['STARTED', 2, 1]]) {
    await assert.rejects(pool.execute('INSERT INTO order_notification_receipts VALUES(?,?,?,?)',
      ['0'.repeat(64), status, started, updated]), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' });
  }
});

const request = { orderId: row.id, eventId, recipientAccountId: buyer };

test('pre-send database recheck detects later cancellation, suspension, identity changes and newer order versions', async () => {
  const candidate = await claimPersistedNotification(pool, request, 2000);
  assert.equal(await recheckNotification(pool, candidate, 3000), true);
  await pool.execute("UPDATE accounts SET status='SUSPENDED' WHERE id=?", [buyer]);
  assert.equal(await recheckNotification(pool, candidate, 3000), false);
  await pool.execute("UPDATE accounts SET status='ACTIVE' WHERE id=?", [buyer]);
  await pool.execute('UPDATE wechat_identities SET open_id=? WHERE account_id=?', ['changed-identity', buyer]);
  assert.equal(await recheckNotification(pool, candidate, 3000), false);
  await pool.execute('UPDATE wechat_identities SET open_id=? WHERE account_id=?', ['openid-' + buyer, buyer]);
  await pool.execute('UPDATE order_aggregates SET version=version+1 WHERE id=?', [row.id]);
  assert.equal(await recheckNotification(pool, candidate, 3000), false);
  await pool.execute('UPDATE order_aggregates SET version=version-1 WHERE id=?', [row.id]);
  await subscription('openid-' + buyer, 'reject', 2);
  assert.equal(await recheckNotification(pool, candidate, 3000), false);
});

test('a definitive or uncertain send receipt cannot pass the pre-send check again', async () => {
  const candidate = await claimPersistedNotification(pool, request, 2000);
  await recordNotificationOutcome(pool, candidate.key, 'UNKNOWN', 3000);
  assert.equal(await recheckNotification(pool, candidate, 4000), false);
  await assert.rejects(recheckNotification({ async execute() { throw Error('private database'); } }, candidate, 4000),
    { code: 'NOTIFICATION_RECHECK_UNCONFIRMED' });
});

test('recovery finds an untriggered persisted event and never replays any consumed receipt', async () => {
  const payload = { events: [{ ...row.payload.events[0], actorId: row.provider_id }], private: 'private-sentinel' };
  await pool.execute('UPDATE order_aggregates SET payload=? WHERE id=?', [JSON.stringify(payload), row.id]);
  const options = { afterId: '', since: 1, until: 3000, limit: 1 };
  const page = await listNotificationRecovery(pool, options);
  assert.deepEqual(page.candidates, [request]); assert.equal(page.hasMore, false);
  assert.doesNotMatch(JSON.stringify(page), /private-sentinel/);
  const candidate = await claimPersistedNotification(pool, request, 2000);
  for (const status of ['STARTED', 'UNKNOWN', 'ACKNOWLEDGED', 'REJECTED']) {
    await pool.execute('UPDATE order_notification_receipts SET status=? WHERE notification_key=?', [status, candidate.key]);
    assert.deepEqual((await listNotificationRecovery(pool, options)).candidates, []);
  }
});

test('recovery cursor progresses through bounded pages even when a page has no eligible events', async () => {
  const secondId = 'ord_' + 'f'.repeat(32);
  await pool.execute(`INSERT INTO order_aggregates(id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,version,created_at,updated_at)
    VALUES(?,?,?,'second-request',?,?,?,2,1000,1000)`, [secondId, buyer, row.provider_id, '0'.repeat(64), row.stage,
    JSON.stringify({ events: [{ ...row.payload.events[0], actorId: row.provider_id }] })]);
  const first = await listNotificationRecovery(pool, { afterId: '', since: 1, until: 3000, limit: 1 });
  assert.equal(first.scanned, 1); assert.equal(first.skippedInvalid, 1); assert.equal(first.nextAfterId, row.id); assert.equal(first.hasMore, true);
  const next = await listNotificationRecovery(pool, { afterId: first.nextAfterId, since: 1, until: 3000, limit: 1 });
  assert.equal(next.scanned, 1); assert.equal(next.candidates[0].orderId, secondId); assert.equal(next.hasMore, false);
  const done = await listNotificationRecovery(pool, { afterId: next.nextAfterId, since: 1, until: 3000, limit: 1 });
  assert.equal(done.scanned, 0);
  await assert.rejects(listNotificationRecovery(pool, { afterId: '', since: 1, until: 3000, limit: 51 }), { code: 'NOTIFICATION_RECOVERY_INVALID' });
});

test('missing, refused, same-second conflicting and future consent cannot consume a notification receipt', async () => {
  for (const scenario of ['missing', 'rejected', 'same-second', 'future', 'other-user']) {
    await pool.query('DELETE FROM wechat_subscription_events');
    if (scenario === 'rejected' || scenario === 'same-second') {
      await subscription('openid-' + buyer, 'accept', 1);
      await subscription('openid-' + buyer, 'reject', scenario === 'same-second' ? 1 : 2);
    }
    if (scenario === 'future') await subscription('openid-' + buyer, 'accept', 4);
    if (scenario === 'other-user') await subscription('openid-' + row.provider_id, 'accept', 1);
    await assert.rejects(claimPersistedNotification(pool, request, 3000), { code: 'NOTIFICATION_NOT_SUBSCRIBED' });
  }
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM order_notification_receipts'); assert.equal(count.n, 0);
  await subscription('openid-' + buyer, 'accept', 2);
  const accepted = await claimPersistedNotification(pool, request, 3000);
  assert.equal(accepted.recipientRole, 'BUYER');
});
test('persisted claim reads server identity and allows one concurrent transaction', async () => {
  const values = await Promise.all(Array.from({ length: 12 }, () => claimPersistedNotification(pool, request, 2000)));
  assert.equal(values.filter(Boolean).length, 1);
  assert.equal(values.find(Boolean).recipientOpenId, 'openid-' + buyer);
});
test('suspended, closed or missing identities cannot create receipts', async () => {
  for (const status of ['SUSPENDED', 'CLOSED']) {
    await pool.execute('UPDATE accounts SET status=? WHERE id=?', [status, buyer]);
    await assert.rejects(claimPersistedNotification(pool, request, 2000), { code: 'NOTIFICATION_RECIPIENT_UNAVAILABLE' });
  }
  await pool.execute("UPDATE accounts SET status='ACTIVE' WHERE id=?", [buyer]);
  await pool.execute('DELETE FROM wechat_identities WHERE account_id=?', [buyer]);
  await assert.rejects(claimPersistedNotification(pool, request, 2000), { code: 'NOTIFICATION_RECIPIENT_UNAVAILABLE' });
  const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM order_notification_receipts'); assert.equal(count.n, 0);
});
test('forged recipient fields and stale events are rejected before consuming a receipt', async () => {
  await assert.rejects(claimPersistedNotification(pool, { ...request, openid: 'forged' }, 2000), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
  await assert.rejects(claimPersistedNotification(pool, { ...request, recipientAccountId: 'acct_' + 'f'.repeat(32) }, 2000), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
  await pool.execute("UPDATE order_aggregates SET stage='DECLINED',version=3 WHERE id=?", [row.id]);
  await assert.rejects(claimPersistedNotification(pool, request, 2000), { code: 'NOTIFICATION_CANDIDATE_INVALID' });
});
test('lost transaction commit acknowledgement never exposes a recipient or allows re-claim', async () => {
  const wrapped = { getConnection: async () => {
    const c = await pool.getConnection();
    return { execute: c.execute.bind(c), beginTransaction: c.beginTransaction.bind(c), rollback: c.rollback.bind(c),
      release: c.release.bind(c), destroy: c.destroy.bind(c), commit: async () => { await c.commit(); throw Error('private-sentinel'); } };
  } };
  await assert.rejects(claimPersistedNotification(wrapped, request, 2000), { code: 'NOTIFICATION_RECEIPT_UNCONFIRMED' });
  assert.equal(await claimPersistedNotification(pool, request, 3000), null);
});
