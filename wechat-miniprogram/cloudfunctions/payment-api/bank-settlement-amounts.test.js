const test = require('node:test');
const assert = require('node:assert/strict');
const { VERSION, platformFee } = require('./fee-policy');
const { calculateOrderAmount, summarizeOrderAmounts } = require('./bank-settlement-amounts');
function row(total = 10000, patch = {}) {
  return { id: 'a'.repeat(32), order_id: 'order_1', provider_id: 'provider_1', payment_mode: 'DIRECT',
    status: 'PAID', payer_verification: 'MATCHED', currency: 'CNY', received_currency: 'CNY',
    amount_fen: String(total), received_total_fen: String(total), platform_fee_fen: String(platformFee(total).amountFen),
    fee_rule_version: VERSION, refunded_fen: '0', platform_refunded_fen: '0', provider_refunded_fen: '0', ...patch };
}
test('gross shares retain provider 80 percent before tax without deducting channel charges', () => {
  assert.deepEqual(calculateOrderAmount(row()), { retainedTotalFen: 10000, platformFeeFen: 2000,
    providerPretaxFen: 8000, feeRuleVersion: VERSION });
});
test('cumulative partial and full refunds use original fee policy, not individual refund rounding', () => {
  const result = calculateOrderAmount(row(10000, { refunded_fen: '3001', platform_refunded_fen: '600', provider_refunded_fen: '2401' }));
  assert.equal(result.providerPretaxFen, 5599); assert.equal(result.platformFeeFen, 1400);
  assert.equal(calculateOrderAmount(row(10000, { refunded_fen: '10000', platform_refunded_fen: '2000', provider_refunded_fen: '8000' })).providerPretaxFen, 0);
});
test('round each order before grouping instead of rounding a provider total again', () => {
  const result = summarizeOrderAmounts([row(3), row(3, {id:'b'.repeat(32),order_id:'order_2'})]);
  assert.equal(result[0].platformFeeFen, 2);
  assert.equal(result[0].providerPretaxFen, 4);
  assert.equal(result[0].orderCount, 2);
});
test('duplicate payment or source order cannot silently double the amount', () => {
  for (const duplicate of [row(), row(10000,{id:'b'.repeat(32)}), row(10000,{order_id:'order_2'})]) {
    assert.throws(() => summarizeOrderAmounts([row(),duplicate]), {code:'BANK_SETTLEMENT_DUPLICATE_SOURCE'});
  }
});
test('unverified, foreign currency and inconsistent refund snapshots fail closed', () => {
  for (const patch of [{status:'PAID_REQUIRES_REVIEW'}, {payment_mode:'COMBINE'}, {payer_verification:'UNKNOWN'},
    {currency:'USD'}, {received_currency:'USD'}, {received_total_fen:'9999'}, {fee_rule_version:'OTHER'},
    {platform_fee_fen:'1999'}, {refunded_fen:'10001'}, {platform_refunded_fen:'1'}, {provider_refunded_fen:'1'}]) {
    assert.throws(() => calculateOrderAmount(row(10000,patch)));
  }
});
test('malformed integer strings and unsafe aggregate amounts are rejected', () => {
  for (const value of ['1e4','',null,true,-1,1.5,'9007199254740992']) {
    assert.throws(() => calculateOrderAmount(row(10000,{amount_fen:value})), {code:'BANK_SETTLEMENT_AMOUNT_INVALID'});
  }
  assert.throws(() => summarizeOrderAmounts([row(Number.MAX_SAFE_INTEGER),
    row(1,{id:'b'.repeat(32),order_id:'order_2'})]), {code:'BANK_SETTLEMENT_AMOUNT_INVALID'});
});
