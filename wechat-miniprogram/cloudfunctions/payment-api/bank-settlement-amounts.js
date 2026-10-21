// Internal calculation only. Does not reserve funds, determine tax, or authorize bank payment.
const { VERSION, platformFee, refundAllocation } = require('./fee-policy');
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function money(value) {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 0) fail('BANK_SETTLEMENT_AMOUNT_INVALID');
  return value;
}
function calculateOrderAmount(payment) {
  if (!payment || payment.payment_mode !== 'DIRECT' || payment.status !== 'PAID'
    || payment.payer_verification !== 'MATCHED' || payment.currency !== 'CNY'
    || payment.received_currency !== 'CNY') fail('BANK_SETTLEMENT_PAYMENT_NOT_READY');
  const total = money(payment.amount_fen), originalFee = money(payment.platform_fee_fen);
  if (total === 0 || money(payment.received_total_fen) !== total
    || payment.fee_rule_version !== VERSION || platformFee(total).amountFen !== originalFee) {
    fail('BANK_SETTLEMENT_SNAPSHOT_MISMATCH');
  }
  const refunded = money(payment.refunded_fen);
  if (refunded > total) fail('BANK_SETTLEMENT_SNAPSHOT_MISMATCH');
  const allocation = refunded === 0 ? {
    retainedTotalFen: total, retainedPlatformFen: originalFee, retainedProviderFen: total - originalFee,
    platformReversalFen: 0, providerReversalFen: 0
  } : refundAllocation({ totalFen: total, platformFeeFen: originalFee, feeRuleVersion: VERSION,
    previouslyRefundedFen: 0, refundFen: refunded });
  if (money(payment.platform_refunded_fen) !== allocation.platformReversalFen
    || money(payment.provider_refunded_fen) !== allocation.providerReversalFen) fail('BANK_SETTLEMENT_SNAPSHOT_MISMATCH');
  return { retainedTotalFen: allocation.retainedTotalFen, platformFeeFen: allocation.retainedPlatformFen,
    providerPretaxFen: allocation.retainedProviderFen, feeRuleVersion: VERSION };
}

// Input rows must come from a server-side, consistently read order/payment selection.
// This total is before tax and previous payouts; never expose it as an available balance.
function summarizeOrderAmounts(rows) {
  if (!Array.isArray(rows)) fail('BANK_SETTLEMENT_INPUT_INVALID');
  const orders = new Set(), payments = new Set(), providers = new Map();
  for (const row of rows) {
    if (!row || typeof row.provider_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.provider_id)
      || typeof row.order_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(row.order_id)
      || typeof row.id !== 'string' || !/^[a-f0-9]{32}$/.test(row.id)) fail('BANK_SETTLEMENT_INPUT_INVALID');
    if (orders.has(row.order_id) || payments.has(row.id)) fail('BANK_SETTLEMENT_DUPLICATE_SOURCE');
    orders.add(row.order_id); payments.add(row.id);
    const amount = calculateOrderAmount(row);
    const aggregate = providers.get(row.provider_id) || { providerId: row.provider_id, orderCount: 0,
      retainedTotalFen: 0, platformFeeFen: 0, providerPretaxFen: 0 };
    for (const key of ['retainedTotalFen', 'platformFeeFen', 'providerPretaxFen']) {
      aggregate[key] = money(aggregate[key] + amount[key]);
    }
    aggregate.orderCount++;
    providers.set(row.provider_id, aggregate);
  }
  return [...providers.values()].sort((a,b) => a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0);
}
module.exports = { calculateOrderAmount, summarizeOrderAmounts };
