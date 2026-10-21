const { inTransaction } = require('./payment-store');
function fail(code) { const error = new Error(code); error.code = code; throw error; }

// Internal only: callers must authorize the buyer/operator before requesting a hold.
// A hold never itself authorizes a refund or resolves a dispute.
async function holdOrderFunds(pool, orderId, reason, now = Date.now()) {
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)
    || !['REFUND_REQUEST', 'DISPUTE'].includes(reason) || !Number.isSafeInteger(now) || now <= 0) fail('FUNDS_HOLD_INPUT_INVALID');
  return inTransaction(pool, async connection => {
    const [[order]] = await connection.execute('SELECT id FROM order_aggregates WHERE id=? FOR UPDATE', [orderId]);
    if (!order) fail('ORDER_NOT_FOUND');
    // A later dispute must remain visible when the refund workflow considers releasing its own hold.
    // Keep the original hold time; another refund must never downgrade an active dispute.
    await connection.execute(`INSERT INTO order_funds_interlocks(order_id,hold_reason,held_at) VALUES(?,?,?)
      ON DUPLICATE KEY UPDATE hold_reason=CASE WHEN hold_reason='DISPUTE' OR VALUES(hold_reason)='DISPUTE'
        THEN 'DISPUTE' ELSE COALESCE(hold_reason,VALUES(hold_reason)) END,held_at=COALESCE(held_at,VALUES(held_at))`,
    [orderId, reason, now]);
    // Acceptance uses an optimistic version check; a concurrent hold must invalidate it.
    await connection.execute('UPDATE order_aggregates SET version=version+1,updated_at=GREATEST(updated_at,?) WHERE id=?', [now, orderId]);
    const [[row]] = await connection.execute('SELECT * FROM order_funds_interlocks WHERE order_id=?', [orderId]);
    return { status: row.settlement_task_id ? 'SETTLEMENT_REVIEW_REQUIRED' : 'HELD', reason: row.hold_reason };
  });
}

// Called with the order row already locked in the same transaction as the submission fence.
async function fenceSettlement(connection, orderId, taskId, now) {
  await connection.execute('INSERT INTO order_funds_interlocks(order_id) VALUES(?) ON DUPLICATE KEY UPDATE order_id=VALUES(order_id)', [orderId]);
  const [[row]] = await connection.execute('SELECT * FROM order_funds_interlocks WHERE order_id=? FOR UPDATE', [orderId]);
  if (row.hold_reason || row.settlement_task_id) return false;
  await connection.execute('UPDATE order_funds_interlocks SET settlement_task_id=?,settlement_started_at=? WHERE order_id=?', [taskId, now, orderId]);
  return true;
}

module.exports = { holdOrderFunds, fenceSettlement };
