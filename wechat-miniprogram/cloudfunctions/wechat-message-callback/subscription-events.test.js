const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSubscriptionEvents: normalize, persistSubscriptionEvents: persist } = require('./subscription-events');
const { TEMPLATE_ID } = require('../../miniprogram/services/order-subscription');
const item = { TemplateId: TEMPLATE_ID, SubscribeStatusString: 'accept', PopupScene: '0' };
const message = { MsgType: 'event', Event: 'subscribe_msg_popup_event', FromUserName: 'private_openid', CreateTime: '1620973045', List: item };

test('official singleton and array JSON forms yield the same deduplicated private observation', () => {
  const rows = normalize(message);
  assert.deepEqual(normalize({ ...message, List: [item, item] }), rows);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurred_at, 1620973045000);
  assert.equal(rows[0].status, 'ACCEPT');
  assert.equal(JSON.stringify(rows).includes('private_openid'), false);
  assert.notEqual(normalize({ ...message, FromUserName: 'other_user' })[0].recipient_key, rows[0].recipient_key);
  assert.deepEqual(normalize({ ...message, List: { ...item, TemplateId: 'unrelated-template' } }), []);
  assert.deepEqual(normalize({ Event: 'wxa_media_check' }), []);
});

test('refusals are distinct immutable evidence and invalid authorization events fail closed', () => {
  const reject = { ...message, Event: 'subscribe_msg_change_event', List: { ...item, SubscribeStatusString: 'reject' } };
  assert.equal(normalize(reject)[0].status, 'REJECT');
  assert.notEqual(normalize(reject)[0].event_key, normalize(message)[0].event_key);
  for (const input of [{ ...message, List: null }, { ...message, List: [] }, { ...message, CreateTime: true },
    { ...message, CreateTime: '9007199254740991' }, { ...message, MsgType: 'text' },
    { ...message, FromUserName: 'bad\nidentity' }, { ...message, List: { ...item, SubscribeStatusString: 'unknown' } },
    { ...reject, List: item }]) {
    assert.throws(() => normalize(input), /SUBSCRIPTION_EVENT_INVALID/);
  }
});

test('repeat and late observations cannot overwrite newer evidence or produce a local send balance', async () => {
  const saved = new Map();
  const db = { from(table) {
    assert.equal(table, 'wechat_subscription_events');
    return { async upsert(rows, options) {
      assert.deepEqual(options, { ignoreDuplicates: true });
      for (const row of rows) if (!saved.has(row.event_key)) saved.set(row.event_key, { ...row });
      return { data: [] };
    } };
  } };
  const accepted = normalize(message);
  const rejected = normalize({ ...message, CreateTime: '1620973046', List: { ...item, SubscribeStatusString: 'reject' } });
  await persist(db, rejected); await persist(db, accepted); await persist(db, accepted);
  assert.equal(saved.size, 2);
  assert.equal([...saved.values()].sort((a, b) => b.occurred_at - a.occurred_at)[0].status, 'REJECT');
  assert.equal([...saved.values()].some(row => Object.hasOwn(row, 'credits')), false);
});

test('persistence failure is not acknowledged and database detail is redacted', async () => {
  const db = { from() { return { async upsert() { return { error: { message: 'private-database' } }; } }; } };
  await assert.rejects(() => persist(db, normalize(message)), { message: 'DATABASE_OPERATION_FAILED' });
});
