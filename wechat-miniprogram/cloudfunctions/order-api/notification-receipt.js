const { buildNotificationCandidate } = require('./notification-candidate');
function fail() { throw Object.assign(new Error('NOTIFICATION_RECEIPT_INVALID'), { code: 'NOTIFICATION_RECEIPT_INVALID' }); }

// The caller supplies a trusted persisted row. No RPC or sending capability here.
// INSERT must be acknowledged before network submission; a lost reply is not permission.
async function claimNotification(pool, row, eventId, recipientAccountId, now = Date.now()) {
  const candidate = buildNotificationCandidate(row, eventId, recipientAccountId);
  if (!Number.isSafeInteger(now) || now < candidate.occurredAt) fail();
  try {
    await pool.execute('INSERT INTO order_notification_receipts(notification_key,status,started_at,updated_at) VALUES(?,\'STARTED\',?,?)',
      [candidate.key, now, now]);
    return candidate;
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') return null;
    throw Object.assign(new Error('NOTIFICATION_RECEIPT_UNCONFIRMED'), { code: 'NOTIFICATION_RECEIPT_UNCONFIRMED' });
  }
}

async function recordNotificationOutcome(pool, key, status, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(key || '') || !['ACKNOWLEDGED', 'REJECTED', 'UNKNOWN'].includes(status)
    || !Number.isSafeInteger(now) || now <= 0) fail();
  // A late definitive result may resolve UNKNOWN, but uncertainty cannot undo a definitive result.
  const [result] = await pool.execute(`UPDATE order_notification_receipts SET status=?,updated_at=?
    WHERE notification_key=? AND status IN ('STARTED','UNKNOWN') AND updated_at<=?`, [status, now, key, now]);
  return result.affectedRows === 1;
}

module.exports = { claimNotification, recordNotificationOutcome };
