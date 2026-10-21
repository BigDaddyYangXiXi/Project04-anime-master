const { prepareSettlement } = require('./settlement-store');
const PAGE_SIZE = 20;

// Internal durable-intent scanner. Prepares tasks only; never calls a money-moving channel.
// The scheduler carries nextCursor across batches and restarts at null after a full pass.
async function prepareAcceptedSettlements(pool, config, cursor = null, clock = Date.now) {
  if (!config || config.settlementPreparationEnabled !== true) return { enabled: false };
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(config.appid || '') || !/^[0-9]{1,32}$/.test(config.platformMchid || '')
    || cursor !== null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(cursor))) {
    const error = new Error('SETTLEMENT_INPUT_INVALID'); error.code = error.message; throw error;
  }
  const [rows] = await pool.execute(`SELECT o.id FROM order_aggregates o
    JOIN order_payments p ON p.order_id=o.id AND p.id=JSON_UNQUOTE(JSON_EXTRACT(o.payload,'$.settlementIntent.paymentId'))
    LEFT JOIN order_settlement_tasks s ON s.order_id=o.id
    WHERE o.stage='COMPLETED' AND JSON_UNQUOTE(JSON_EXTRACT(o.payload,'$.settlementIntent.status'))='PENDING'
      AND p.appid=? AND p.platform_mchid=? AND s.id IS NULL AND o.id>?
    ORDER BY o.id LIMIT ${PAGE_SIZE + 1}`, [config.appid, config.platformMchid, cursor || '']);
  const page = rows.slice(0, PAGE_SIZE);
  const summary = { enabled: true, examined: page.length, prepared: 0, deferred: 0,
    nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].id : null };
  for (const row of page) {
    try { await prepareSettlement(pool, row.id, clock()); summary.prepared++; }
    catch (_) { summary.deferred++; } // Durable intent remains pending for the next full pass.
  }
  return summary;
}

module.exports = { prepareAcceptedSettlements, PAGE_SIZE };
