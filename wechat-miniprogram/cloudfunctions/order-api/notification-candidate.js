const crypto = require('node:crypto');

// Internal projection of a persisted order row, not a client/RPC handler.
// The future sender must still check active identity, subscription and durable send state.
function buildNotificationCandidate(row, eventId, recipientAccountId) {
  const fail = () => { throw Object.assign(new Error('NOTIFICATION_CANDIDATE_INVALID'), { code: 'NOTIFICATION_CANDIDATE_INVALID' }); };
  if (!row || !/^ord_[a-f0-9]{32}$/.test(row.id || '') || !/^evt_[a-f0-9]{32}$/.test(eventId || '')
    || !/^acct_[a-f0-9]{32}$/.test(recipientAccountId || '')
    || ![row.buyer_id, row.provider_id].includes(recipientAccountId)) fail();
  let payload;
  try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload; }
  catch { fail(); }
  if (!Array.isArray(payload?.events) || !payload.events.length) fail();
  const event = payload.events[payload.events.length - 1];
  const version = typeof row.version === 'string' && /^[1-9][0-9]*$/.test(row.version) ? Number(row.version) : row.version;
  // Do not turn a delayed job into an obsolete status reminder or reuse a forged event id.
  if (!event || event.id !== eventId || event.toStage !== row.stage
    || typeof row.stage !== 'string' || !/^[A-Z_]{1,32}$/.test(row.stage)
    || !Number.isSafeInteger(version) || version < 1
    || !Number.isSafeInteger(event.createdAt) || event.createdAt <= 0) fail();
  return {
    key: crypto.createHash('sha256').update(JSON.stringify([row.id, eventId, recipientAccountId])).digest('hex'),
    orderId: row.id, eventId, recipientAccountId, orderVersion: version,
    recipientRole: row.buyer_id === recipientAccountId ? 'BUYER' : 'PROVIDER',
    stage: row.stage, occurredAt: event.createdAt
  };
}

module.exports = { buildNotificationCandidate };
