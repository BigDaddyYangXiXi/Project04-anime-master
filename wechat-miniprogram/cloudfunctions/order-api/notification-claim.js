const { buildNotificationCandidate } = require('./notification-candidate');
const { claimNotification } = require('./notification-receipt');
const crypto = require('node:crypto');
const { TEMPLATE_ID } = require('./notification-message');
function fail(code) { throw Object.assign(new Error(code), { code }); }

// Internal-only boundary: never accept a caller-supplied row, openid or message body.
// A receipt prevents duplicate submission, but does not prove WeChat subscription consent.
async function claimPersistedNotification(pool, request, now = Date.now()) {
  if (!request || Object.keys(request).some(key => !['orderId', 'eventId', 'recipientAccountId'].includes(key))
    || !['orderId', 'eventId', 'recipientAccountId'].every(key => typeof request[key] === 'string')
    || !/^ord_[a-f0-9]{32}$/.test(request.orderId) || !/^evt_[a-f0-9]{32}$/.test(request.eventId)
    || !/^acct_[a-f0-9]{32}$/.test(request.recipientAccountId)
    || !Number.isSafeInteger(now) || now <= 0) fail('NOTIFICATION_CANDIDATE_INVALID');
  let connection, commitStarted = false, reusable = true;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [[row]] = await connection.execute('SELECT id,buyer_id,provider_id,stage,payload,version FROM order_aggregates WHERE id=? FOR SHARE', [request.orderId]);
    buildNotificationCandidate(row, request.eventId, request.recipientAccountId);
    const [[identity]] = await connection.execute(`SELECT w.open_id FROM accounts a
      JOIN wechat_identities w ON w.account_id=a.id WHERE a.id=? AND a.status='ACTIVE' FOR SHARE`, [request.recipientAccountId]);
    if (!identity || typeof identity.open_id !== 'string' || !identity.open_id.trim()) fail('NOTIFICATION_RECIPIENT_UNAVAILABLE');
    const recipientKey = crypto.createHash('sha256').update(JSON.stringify(identity.open_id)).digest('hex');
    const [[subscription]] = await connection.execute(`SELECT status,occurred_at FROM wechat_subscription_events
      WHERE recipient_key=? AND template_id=? ORDER BY occurred_at DESC,(status='REJECT') DESC LIMIT 1 FOR SHARE`,
    [recipientKey, TEMPLATE_ID]);
    // A verified observation is necessary but not a remaining-credit balance.
    // WeChat remains authoritative about whether this one-time subscription can send.
    if (!subscription || subscription.status !== 'ACCEPT' || Number(subscription.occurred_at) > now) {
      fail('NOTIFICATION_NOT_SUBSCRIBED');
    }
    const candidate = await claimNotification(connection, row, request.eventId, request.recipientAccountId, now);
    commitStarted = true;
    await connection.commit();
    return candidate ? { ...candidate, recipientOpenId: identity.open_id } : null;
  } catch (error) {
    if (connection) {
      try { await connection.rollback(); } catch { reusable = false; }
      if (commitStarted) reusable = false;
    }
    const known = ['NOTIFICATION_CANDIDATE_INVALID', 'NOTIFICATION_RECIPIENT_UNAVAILABLE', 'NOTIFICATION_RECEIPT_INVALID', 'NOTIFICATION_NOT_SUBSCRIBED'];
    fail(known.includes(error && error.code) ? error.code : 'NOTIFICATION_RECEIPT_UNCONFIRMED');
  } finally {
    if (connection) { if (reusable) connection.release(); else connection.destroy(); }
  }
}

module.exports = { claimPersistedNotification };
