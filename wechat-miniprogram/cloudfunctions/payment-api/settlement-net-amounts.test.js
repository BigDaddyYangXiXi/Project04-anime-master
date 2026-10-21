const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSettlementNet } = require('./settlement-net-amounts');
const { VERSION } = require('./fee-policy');
function payment(patch = {}) {
  return { payment_mode: 'DIRECT', status: 'PAID', payer_verification: 'MATCHED', currency: 'CNY',
    received_currency: 'CNY', amount_fen: '10000', received_total_fen: '10000', platform_fee_fen: '2000',
    fee_rule_version: VERSION, refunded_fen: '0', platform_refunded_fen: '0', provider_refunded_fen: '0', ...patch };
}
test('100 yuan settlement credits provider 80, channel cost belongs to platform 20', () => {
  const result = calculateSettlementNet(payment(), { withholdingFen: 0, platformCostFen: 60 });
  assert.equal(result.providerNetFen, 8000);
  assert.equal(result.platformAfterCostFen, 1940);
  assert.equal(result.providerNetFen + result.withholdingFen + result.platformAfterCostFen + result.platformCostFen, 10000);
});
test('bank cost overruns remain platform losses and never silently charge the provider', () => {
  const result = calculateSettlementNet(payment(), { withholdingFen: 0, platformCostFen: 2100 });
  assert.equal(result.providerNetFen, 8000); assert.equal(result.platformAfterCostFen, -100);
});
test('confirmed provider withholding is deducted at settlement, independently of platform costs', () => {
  const result = calculateSettlementNet(payment(), { withholdingFen: 500, platformCostFen: 100 });
  assert.equal(result.providerNetFen, 7500); assert.equal(result.platformAfterCostFen, 1900);
});
test('missing tax or cost is never assumed zero', () => {
  for (const input of [undefined, {}, { platformCostFen: 60 }, { withholdingFen: 0 },
    { withholdingFen: null, platformCostFen: 0 }, { withholdingFen: 0, platformCostFen: NaN }]) {
    assert.throws(() => calculateSettlementNet(payment(), input), /UNCONFIRMED/);
  }
  assert.throws(() => calculateSettlementNet(payment(), { withholdingFen: 8001, platformCostFen: 0 }), /EXCEEDS_INCOME/);
});
test('cumulative refunds use original fee allocation before calculating net income', () => {
  const result = calculateSettlementNet(payment({ refunded_fen: '3001', platform_refunded_fen: '600', provider_refunded_fen: '2401' }),
    { withholdingFen: 99, platformCostFen: 42 });
  assert.equal(result.providerPretaxFen, 5599); assert.equal(result.providerNetFen, 5500);
  assert.equal(result.platformFeeFen, 1400); assert.equal(result.platformAfterCostFen, 1358);
});
test('full refund or full withholding produces no withdrawable credit', () => {
  assert.equal(calculateSettlementNet(payment(), { withholdingFen: 8000, platformCostFen: 60 }).providerNetFen, 0);
  const result = calculateSettlementNet(payment({ refunded_fen: '10000', platform_refunded_fen: '2000', provider_refunded_fen: '8000' }),
    { withholdingFen: 0, platformCostFen: 10 });
  assert.equal(result.providerNetFen, 0); assert.equal(result.platformAfterCostFen, -10);
});
