const test = require('node:test');
const assert = require('node:assert/strict');
const { reviewSettlementCost } = require('./settlement-cost-review');
const scenario = patch => ({ transactionBaseFen: '10000', proposedBasisPoints: 2000,
  costs: { collection: '60', bankPayout: '100', verification: '0', infrastructure: '0', platformTax: '0', otherMandatory: '0' }, ...patch });
test('cost floor includes fixed costs and warns below the scenario break-even rate', () => {
  const result = reviewSettlementCost(scenario({ proposedBasisPoints: 100 }));
  assert.equal(result.minimumBasisPoints, '160'); assert.equal(result.status, 'BELOW_COST');
  assert.equal(result.platformAfterCostFen, '-60');
});
test('current 20 percent review does not change production fee calculation', () => {
  assert.equal(reviewSettlementCost(scenario()).platformAfterCostFen, '1840');
  assert.equal(require('../cloudfunctions/payment-api/fee-policy').platformFee(10000).amountFen, 2000);
});
test('unknown tax or bank fee is not silently zero', () => {
  const input = scenario(); delete input.costs.platformTax;
  assert.deepEqual(reviewSettlementCost(input), { status: 'COSTS_UNCONFIRMED', missing: ['platformTax'], minimumBasisPoints: null });
});
test('break-even is distinct from positive margin and fixed fees can exceed all revenue', () => {
  assert.equal(reviewSettlementCost(scenario({ proposedBasisPoints: 160 })).status, 'BREAK_EVEN');
  const result = reviewSettlementCost(scenario({ transactionBaseFen: '100', proposedBasisPoints: 10000 }));
  assert.equal(result.minimumBasisPoints, '16000'); assert.equal(result.status, 'BELOW_COST');
});
test('integer arithmetic retains large accumulated amounts', () => {
  const result = reviewSettlementCost(scenario({ transactionBaseFen: '90071992547409930' }));
  assert.equal(result.platformFeeFen, '18014398509481986');
});
test('invalid numbers and zero transaction denominator are rejected', () => {
  for (const value of ['0', '-1', '1.2', '1e4', 10000]) assert.throws(() => reviewSettlementCost(scenario({ transactionBaseFen: value })));
  for (const value of [-1, 10001, 0.6, null]) assert.throws(() => reviewSettlementCost(scenario({ proposedBasisPoints: value })));
});
test('unknown costs cannot be silently ignored, including provider tax', () => {
  for (const key of ['bankFee', 'providerTax']) {
    const input = scenario(); input.costs[key] = '100';
    assert.throws(() => reviewSettlementCost(input), /COST_CATEGORY_INVALID/);
  }
  assert.throws(() => reviewSettlementCost(scenario({ costs: [] })), /COST_CATEGORY_INVALID/);
});
test('missing cost does not hide invalid supplied money', () => {
  const input = scenario(); input.costs.bankPayout = '-100'; delete input.costs.platformTax;
  assert.throws(() => reviewSettlementCost(input), /COST_AMOUNT_INVALID/);
});
