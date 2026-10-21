const crypto = require('node:crypto');
const TEMPLATE_ID = 'x5-tvzV9SaOPUjOLPT_lZBpqWnfCYKFU1LYI-JsqDGQ';
const EVENTS = ['subscribe_msg_popup_event', 'subscribe_msg_change_event'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Only call after verifying and decrypting the company WeChat envelope.
// These are observations, not subscription credits: callbacks have no unique grant id.
function normalizeSubscriptionEvents(message) {
  if (!message || !EVENTS.includes(message.Event)) return [];
  const invalid = () => { throw new Error('SUBSCRIPTION_EVENT_INVALID'); };
  if (message.MsgType !== 'event' || typeof message.FromUserName !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(message.FromUserName)
    || !/^[1-9][0-9]*$/.test(String(message.CreateTime))) invalid();
  const occurredAt = Number(message.CreateTime) * 1000;
  if (!Number.isSafeInteger(occurredAt)) invalid();
  const list = Array.isArray(message.List) ? message.List : [message.List];
  if (!list.length || list.some(item => !item || typeof item !== 'object')) invalid();
  const recipientKey = digest(message.FromUserName);
  const observations = new Map();
  for (const item of list) {
    if (item.TemplateId !== TEMPLATE_ID) continue;
    const status = item.SubscribeStatusString;
    if (!['accept', 'reject'].includes(status)
      || (message.Event === 'subscribe_msg_change_event' && status !== 'reject')) invalid();
    const row = {
      event_key: digest([recipientKey, TEMPLATE_ID, message.Event, occurredAt, status]),
      recipient_key: recipientKey, template_id: TEMPLATE_ID,
      event_type: message.Event === EVENTS[0] ? 'POPUP' : 'CHANGE',
      status: status === 'accept' ? 'ACCEPT' : 'REJECT', occurred_at: occurredAt
    };
    observations.set(row.event_key, row);
  }
  return [...observations.values()];
}

async function persistSubscriptionEvents(db, observations) {
  if (!observations.length) return;
  // Immutable observations survive duplicate delivery and out-of-order callbacks.
  // The latest status must be resolved by occurred_at, with REJECT winning a tie.
  const result = await db.from('wechat_subscription_events').upsert(observations, { ignoreDuplicates: true });
  if (!result || result.error) throw new Error('DATABASE_OPERATION_FAILED');
}

module.exports = { normalizeSubscriptionEvents, persistSubscriptionEvents };
