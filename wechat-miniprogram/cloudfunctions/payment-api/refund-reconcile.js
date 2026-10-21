const crypto = require('node:crypto');
const { inTransaction } = require('./payment-store');
const { refreshRefund } = require('./refund-results');
const { queryRefund } = require('./wechat-refund');
const INTERVAL_MS = 60000, LEASE_MS = 30000, BATCH_SIZE = 5;

// Internal worker only. It never submits refunds or exposes a public scan action.
async function reconcileRefunds(pool, config, channel = queryRefund, clock = Date.now) {
  if (config?.refundReconciliationEnabled !== true) return { enabled: false };
  const started = clock();
  if (!Number.isSafeInteger(started) || started <= 0 || !Number.isSafeInteger(started + LEASE_MS)
    || typeof config.appid !== 'string' || !config.appid || !/^\d{1,32}$/.test(config.platformMchid || '')) throw Error('REFUND_QUERY_NOT_CONFIGURED');
  const [candidates] = await pool.execute(`SELECT f.id,f.order_id,f.payment_id FROM order_refunds f
    JOIN order_payments p ON p.id=f.payment_id AND p.order_id=f.order_id AND p.platform_mchid=f.platform_mchid
    WHERE f.platform_mchid=? AND p.appid=? AND f.status IN ('SUBMITTING','PROCESSING','ABNORMAL') AND f.submission_started_at IS NOT NULL
      AND f.query_started_at<=? AND f.query_lease_until<=? AND (f.submission_lease_until IS NULL OR f.submission_lease_until<=?)
    ORDER BY f.query_started_at,f.created_at,f.id LIMIT ${BATCH_SIZE}`, [config.platformMchid,config.appid,started-INTERVAL_MS,started,started]);
  const summary = { enabled:true, examined:0, queried:0, skipped:0, failed:0 };
  for (const candidate of candidates) {
    const now = clock();
    if (now-started >= 30000) break;
    summary.examined++;
    let token;
    try {
      token = await inTransaction(pool, async connection => {
        const [[order]] = await connection.execute('SELECT id FROM order_aggregates WHERE id=? FOR UPDATE',[candidate.order_id]);
        const [[payment]] = await connection.execute('SELECT appid,platform_mchid FROM order_payments WHERE id=? FOR UPDATE',[candidate.payment_id]);
        const [[refund]] = await connection.execute('SELECT * FROM order_refunds WHERE id=? FOR UPDATE',[candidate.id]);
        if (!order || !payment || !refund || payment.appid !== config.appid || payment.platform_mchid !== config.platformMchid
          || refund.platform_mchid !== config.platformMchid || !['SUBMITTING','PROCESSING','ABNORMAL'].includes(refund.status)
          || refund.submission_started_at == null || Number(refund.submission_lease_until)>now
          || Number(refund.query_started_at)+INTERVAL_MS>now || Number(refund.query_lease_until)>now) return null;
        const lease = crypto.randomBytes(16).toString('hex');
        await connection.execute('UPDATE order_refunds SET query_started_at=?,query_lease_until=?,query_lease_token=? WHERE id=?',
          [now,now+LEASE_MS,lease,refund.id]);
        return lease;
      });
      if (!token) { summary.skipped++; continue; }
      await refreshRefund(pool,candidate.id,config,channel,clock);
      summary.queried++;
    } catch { summary.failed++; }
    finally {
      if (token) {
        try { await pool.execute('UPDATE order_refunds SET query_lease_until=0,query_lease_token=NULL WHERE id=? AND query_lease_token=?',[candidate.id,token]); }
        catch { /* The durable lease expires; never retry channel submission or report sensitive errors. */ }
      }
    }
  }
  return summary;
}
module.exports = { reconcileRefunds, INTERVAL_MS, LEASE_MS, BATCH_SIZE };
