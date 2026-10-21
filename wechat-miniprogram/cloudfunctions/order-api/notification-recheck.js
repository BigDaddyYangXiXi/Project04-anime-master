const crypto = require('node:crypto');
const { buildNotificationCandidate } = require('./notification-candidate');
const { TEMPLATE_ID } = require('./notification-message');

// Server-only, immediately before channel submission. One statement reads a consistent
// current snapshot; it cannot prevent changes after the query or replace WeChat consent enforcement.
async function recheckNotification(pool, candidate, now = Date.now()) {
  if (!candidate || typeof candidate.recipientOpenId !== 'string' || !Number.isSafeInteger(now) || now <= 0) return false;
  const recipientKey = crypto.createHash('sha256').update(JSON.stringify(candidate.recipientOpenId)).digest('hex');
  let row;
  try {
    [[row]] = await pool.execute(`SELECT o.id,o.buyer_id,o.provider_id,o.stage,o.payload,o.version,
      (SELECT CASE WHEN s.status='ACCEPT' AND s.occurred_at<=? THEN 1 ELSE 0 END
       FROM wechat_subscription_events s WHERE s.recipient_key=? AND s.template_id=?
       ORDER BY s.occurred_at DESC,(s.status='REJECT') DESC LIMIT 1) AS subscribed
      FROM order_aggregates o JOIN accounts a ON a.id=? AND a.status='ACTIVE'
      JOIN wechat_identities w ON w.account_id=a.id AND w.open_id=?
      JOIN order_notification_receipts r ON r.notification_key=? AND r.status='STARTED'
      WHERE o.id=?`, [now, recipientKey, TEMPLATE_ID, candidate.recipientAccountId,
      candidate.recipientOpenId, candidate.key, candidate.orderId]);
  } catch (_) {
    throw Object.assign(new Error('NOTIFICATION_RECHECK_UNCONFIRMED'), { code: 'NOTIFICATION_RECHECK_UNCONFIRMED' });
  }
  if (!row || Number(row.subscribed) !== 1) return false;
  try {
    const current = buildNotificationCandidate(row, candidate.eventId, candidate.recipientAccountId);
    return Object.keys(current).every(key => current[key] === candidate[key]);
  } catch (_) { return false; }
}

module.exports = { recheckNotification };
