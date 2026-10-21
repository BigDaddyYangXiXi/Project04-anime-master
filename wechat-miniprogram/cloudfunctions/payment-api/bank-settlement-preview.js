const { calculateOrderAmount } = require('./bank-settlement-amounts');
// A preliminary read, never a reservation or a declaration of bank-payable funds.
async function readBankSettlementPreview(pool, paymentId, config) {
  if (typeof paymentId !== 'string' || !/^[a-f0-9]{32}$/.test(paymentId)
    || typeof config?.appid !== 'string' || !config.appid
    || typeof config.platformMchid !== 'string' || !config.platformMchid) throw Error('BANK_PREVIEW_INPUT_INVALID');
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION READ ONLY');
    const [[payment]] = await connection.execute(`SELECT p.*,o.provider_id,o.stage AS order_stage,o.version AS current_order_version,o.payload AS order_payload
      FROM order_payments p JOIN order_aggregates o ON o.id=p.order_id
      WHERE p.id=? AND p.appid=? AND p.platform_mchid=? AND p.payment_mode='DIRECT'`,
    [paymentId,config.appid,config.platformMchid]);
    if (!payment) throw Error('PAYMENT_NOT_FOUND');
    const [refunds] = await connection.execute('SELECT status FROM order_refunds WHERE payment_id=?', [paymentId]);
    const [[interlock]] = await connection.execute('SELECT hold_reason,settlement_task_id FROM order_funds_interlocks WHERE order_id=?', [payment.order_id]);
    const { amounts, blockers } = inspectBankOrder(payment, refunds, interlock);
    // These checks need the forthcoming ledger/bank batch implementation and verified bank rules.
    blockers.push('LEDGER_AND_PRIOR_PAYOUT_CHECK_REQUIRED','BANK_ACCOUNT_AND_TAX_CHECK_REQUIRED');
    await connection.commit();
    return { paymentId, orderId: payment.order_id, providerId: payment.provider_id, amounts,
      payable: false, blockers, scope: 'PRELIMINARY_ORDER_AMOUNTS_ONLY' };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
function inspectBankOrder(payment, refunds, interlock) {
  const blockers = [];
  let amounts = null;
  try { amounts = calculateOrderAmount(payment); } catch { blockers.push('PAYMENT_AMOUNTS_UNVERIFIED'); }
  const payload = typeof payment.order_payload === 'string' ? JSON.parse(payment.order_payload) : payment.order_payload;
  const publicOrder = payload?.public, intent = payload?.settlementIntent;
  if (payment.order_stage !== 'COMPLETED' || !intent || intent.status !== 'PENDING'
    || !Number.isSafeInteger(intent.acceptedOrderVersion) || intent.acceptedOrderVersion < 1
    || !Number.isSafeInteger(Number(payment.current_order_version)) || intent.acceptedOrderVersion > Number(payment.current_order_version)
    || !Number.isSafeInteger(intent.createdAt) || intent.createdAt <= 0 || intent.createdAt !== publicOrder?.completedAt
    || intent.paymentId !== payment.id || publicOrder?.paymentId !== payment.id || publicOrder?.paymentStatus !== 'PAID'
    || !payment.transaction_id || publicOrder?.paymentTransactionId !== payment.transaction_id
    || publicOrder?.amountFen !== Number(payment.amount_fen)) blockers.push('ORDER_ACCEPTANCE_UNVERIFIED');
  if (refunds.some(row => !['SUCCESS','REJECTED','CLOSED'].includes(row.status))) blockers.push('REFUND_UNRESOLVED');
  if (!interlock) blockers.push('FUNDS_INTERLOCK_MISSING');
  else {
    if (interlock.hold_reason) blockers.push('FUNDS_HELD');
    if (interlock.settlement_task_id) blockers.push('CHANNEL_SETTLEMENT_STARTED');
  }
  if (amounts?.providerPretaxFen === 0) blockers.push('NO_RETAINED_PROVIDER_INCOME');
  return { amounts, blockers };
}
module.exports = { readBankSettlementPreview, inspectBankOrder };
