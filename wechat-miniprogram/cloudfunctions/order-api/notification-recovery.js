const { buildNotificationCandidate } = require('./notification-candidate');

// Bounded, read-only recovery scan. A candidate still needs normal claim/recheck/WeChat
// authorization. Any receipt, including UNKNOWN or REJECTED, excludes automatic replay.
async function listNotificationRecovery(pool, input) {
  if (!input || Object.keys(input).some(key => !['afterId', 'since', 'until', 'limit'].includes(key))
    || typeof input.afterId !== 'string' || (input.afterId !== '' && !/^ord_[a-f0-9]{32}$/.test(input.afterId))
    || !Number.isSafeInteger(input.since) || input.since <= 0 || !Number.isSafeInteger(input.until) || input.until < input.since
    || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw Object.assign(new Error('NOTIFICATION_RECOVERY_INVALID'), { code: 'NOTIFICATION_RECOVERY_INVALID' });
  }
  try {
    // Page by immutable primary key before filtering the time window: each call reads
    // at most limit+1 rows, even if almost every order is outside the requested window.
    const [rows] = await pool.execute(`SELECT id,buyer_id,provider_id,stage,payload,version,updated_at
      FROM order_aggregates WHERE id>? ORDER BY id LIMIT ?`, [input.afterId, input.limit + 1]);
    const scanned = rows.slice(0, input.limit), candidates = [];
    let skippedInvalid = 0;
    for (const row of scanned) {
      if (Number(row.updated_at) < input.since || Number(row.updated_at) > input.until) continue;
      try {
        const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        const event = payload?.events?.[payload.events.length - 1];
        if (!event || ![row.buyer_id, row.provider_id].includes(event.actorId) || row.buyer_id === row.provider_id) throw Error('invalid');
        const recipient = event.actorId === row.buyer_id ? row.provider_id : row.buyer_id;
        const candidate = buildNotificationCandidate(row, event.id, recipient);
        if (candidate.occurredAt < input.since || candidate.occurredAt > input.until) continue;
        candidates.push(candidate);
      } catch (_) { skippedInvalid++; }
    }
    const existing = candidates.length ? (await pool.execute(`SELECT notification_key FROM order_notification_receipts
      WHERE notification_key IN (${candidates.map(() => '?').join(',')})`, candidates.map(item => item.key)))[0] : [];
    const consumed = new Set(existing.map(row => row.notification_key));
    return { scanned: scanned.length, skippedInvalid, hasMore: rows.length > input.limit,
      nextAfterId: scanned.length ? scanned[scanned.length - 1].id : input.afterId,
      candidates: candidates.filter(item => !consumed.has(item.key)).map(item => ({
        orderId: item.orderId, eventId: item.eventId, recipientAccountId: item.recipientAccountId
      })) };
  } catch (_) {
    throw Object.assign(new Error('NOTIFICATION_RECOVERY_UNCONFIRMED'), { code: 'NOTIFICATION_RECOVERY_UNCONFIRMED' });
  }
}

module.exports = { listNotificationRecovery };
