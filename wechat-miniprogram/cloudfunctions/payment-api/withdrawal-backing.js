const { inspectBankOrder } = require('./bank-settlement-preview');
const { auditFundsInSnapshot } = require('./fund-audit');

// Caller holds the withdrawal request lock and owns the transaction.
// Discovery bindings come from outside the transaction; only the locked read is authoritative.
async function lockWithdrawalBacking(connection, requestId, approvedFen, providerId, bindings, config) {
  if (!bindings.length || bindings.length > 100) throw Error('WITHDRAWAL_SOURCE_MISSING');
  const ordered = [...bindings].sort((a, b) => a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 :
    a.payment_id.localeCompare(b.payment_id));
  const payments = new Map();
  // Same order/payment lock order as refunds, dispute holds and financial approval.
  // Do not establish a consistent-read snapshot before these locks are acquired.
  for (const source of ordered) {
    const [[order]] = await connection.execute('SELECT * FROM order_aggregates WHERE id=? FOR UPDATE', [source.order_id]);
    const [[payment]] = await connection.execute(`SELECT * FROM order_payments
      WHERE id=? AND appid=? AND platform_mchid=? AND payment_mode='DIRECT' FOR UPDATE`,
    [source.payment_id, config.appid, config.platformMchid]);
    if (!order || !payment || payment.order_id !== order.id || order.provider_id !== providerId) {
      throw Error('WITHDRAWAL_SOURCE_NOT_FOUND');
    }
    payments.set(payment.id, { ...payment, provider_id: order.provider_id,
      order_stage: order.stage, current_order_version: order.version, order_payload: order.payload });
  }
  const nets = new Map();
  for (const paymentId of [...payments.keys()].sort()) {
    const [[net]] = await connection.execute(`SELECT provider_id,CAST(provider_net_fen AS CHAR) AS amount
      FROM finance_net_settlements WHERE payment_id=? FOR UPDATE`, [paymentId]);
    if (!net || net.provider_id !== providerId) throw Error('WITHDRAWAL_SOURCE_NOT_FOUND');
    nets.set(paymentId, net);
  }
  const [sources] = await connection.execute(`SELECT payment_id,CAST(amount_fen AS CHAR) AS amount
    FROM withdrawal_sources WHERE withdrawal_id=? ORDER BY payment_id FOR UPDATE`, [requestId]);
  if (sources.length !== payments.size || sources.some(s => !payments.has(s.payment_id))
    || sources.reduce((sum, s) => sum + BigInt(s.amount), 0n) !== BigInt(approvedFen)) {
    throw Error('WITHDRAWAL_SOURCE_TOTAL_MISMATCH');
  }
  for (const source of sources) {
    const payment = payments.get(source.payment_id);
    const [used] = await connection.execute(`SELECT CAST(amount_fen AS CHAR) AS amount
      FROM withdrawal_sources WHERE payment_id=? ORDER BY withdrawal_id FOR UPDATE`, [payment.id]);
    if (used.reduce((sum, s) => sum + BigInt(s.amount), 0n) > BigInt(nets.get(payment.id).amount)) {
      throw Error('WITHDRAWAL_SOURCE_UNAVAILABLE');
    }
    const [refunds] = await connection.execute('SELECT status FROM order_refunds WHERE payment_id=?', [payment.id]);
    const [[hold]] = await connection.execute('SELECT hold_reason,settlement_task_id FROM order_funds_interlocks WHERE order_id=?', [payment.order_id]);
    if (inspectBankOrder(payment, refunds, hold).blockers.length) throw Error('WITHDRAWAL_SOURCE_NOT_READY');
    if (!(await auditFundsInSnapshot(connection, payment)).ok) throw Error('WITHDRAWAL_SOURCE_LEDGER_MISMATCH');
  }
}
module.exports = { lockWithdrawalBacking };
