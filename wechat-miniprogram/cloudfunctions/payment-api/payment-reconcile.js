const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const { executeClaimedQuery, LEASE_MS } = require('./payment-refresh');
const { queryPayment } = require('./wechat-query');
const INTERVAL_MS = 60000;
const BATCH_SIZE = 5;

// Internal scheduled executor, deliberately absent from the client-facing dispatcher.
async function reconcilePayments(pool, config, query = queryPayment, clock = Date.now) {
  if (!config || config.reconciliationEnabled !== true) return { enabled: false };
  const started = clock();
  if (!Number.isSafeInteger(started) || started <= 0 || !Number.isSafeInteger(started + LEASE_MS)
    || !/^[A-Za-z0-9_-]{1,32}$/.test(config.appid || '') || !/^[0-9]{1,32}$/.test(config.platformMchid || '')) {
    const error = new Error('PAYMENT_QUERY_NOT_CONFIGURED'); error.code = error.message; throw error;
  }
  const [candidates] = await pool.execute(`SELECT id,order_id FROM order_payments
    WHERE status='CREATED' AND appid=? AND platform_mchid=? AND prepay_started_at>0
      AND query_started_at<=? AND query_lease_until<=?
    ORDER BY query_started_at,created_at,id LIMIT ${BATCH_SIZE}`,
  [config.appid, config.platformMchid, started - INTERVAL_MS, started]);
  const summary = { enabled: true, examined: 0, queried: 0, skipped: 0, failed: 0 };
  for (const candidate of candidates) {
    // Do not start another up-to-32-second channel sequence after this batch's time window.
    const now = clock();
    if (now - started >= 30000) break;
    summary.examined++;
    try {
      const lease = await inTransaction(pool, async connection => {
        const [[order]] = await connection.execute('SELECT id FROM order_aggregates WHERE id=? FOR UPDATE', [candidate.order_id]);
        const [[payment]] = await connection.execute('SELECT * FROM order_payments WHERE id=? FOR UPDATE', [candidate.id]);
        if (!order || !payment || payment.order_id !== order.id || payment.status !== 'CREATED'
          || payment.appid !== config.appid || payment.platform_mchid !== config.platformMchid
          || !(Number(payment.prepay_started_at) > 0) || Number(payment.query_started_at) + INTERVAL_MS > now
          || Number(payment.query_lease_until) > now) return;
        const token = crypto.randomBytes(16).toString('hex');
        await connection.execute('UPDATE order_payments SET query_started_at=?,query_lease_until=?,query_lease_token=? WHERE id=?',
          [now, now + LEASE_MS, token, payment.id]);
        return { paymentId: payment.id, lease: token };
      });
      if (!lease) { summary.skipped++; continue; }
      await executeClaimedQuery(pool, lease, config, query, clock);
      summary.queried++;
    } catch (_) { summary.failed++; } // No order identifiers, credentials or upstream bodies in scheduled output.
  }
  return summary;
}

module.exports = { reconcilePayments, INTERVAL_MS, BATCH_SIZE };
