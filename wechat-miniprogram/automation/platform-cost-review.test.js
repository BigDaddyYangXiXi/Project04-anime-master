const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reviewPlatformCost } = require('../scripts/platform-cost-review');
const scenario = () => ({ scenario: 'synthetic-period', retainedTotalFen: '10000', proposedBps: 160,
  costs: Object.fromEntries(['channel', 'bank', 'verification', 'platformTax', 'otherMandatory'].map((key, i) =>
    [key, { fen: i === 0 ? '60' : i === 1 ? '100' : '0', evidenceReference: 'fixture', validFrom: 1, validUntil: 100 }])) });
test('scenario cost covers platform charges without changing the fee policy', () => {
  const input = scenario();
  const r = reviewPlatformCost(input, 50);
  assert.equal(r.coverageBps, '160'); assert.equal(r.status, 'AT_SCENARIO_COST');
  assert.equal(r.productionRateChanged, false);
  assert.equal(reviewPlatformCost({ ...input, proposedBps: 159 }, 50).status, 'BELOW_SCENARIO_COST');
  assert.equal(reviewPlatformCost({ ...input, proposedBps: 2000 }, 50).status, 'ABOVE_SCENARIO_COST');
});
test('missing, expired and not-yet-effective costs are unknown, not zero', () => {
  for (const patch of [undefined, { ...scenario().costs.bank, validUntil: 50 },
    { ...scenario().costs.bank, validFrom: 51 }, { ...scenario().costs.bank, evidenceReference: '' }]) {
    const input = scenario(); input.costs.bank = patch;
    const r = reviewPlatformCost(input, 50);
    assert.equal(r.status, 'COST_UNCONFIRMED'); assert.equal(r.coverageBps, null);
    assert.deepEqual(r.missing, ['bank']);
  }
});
test('full refund does not divide by zero; large sums and ratio rounding stay exact', () => {
  const input = scenario(); input.retainedTotalFen = '0';
  assert.equal(reviewPlatformCost(input, 50).status, 'NO_RETAINED_REVENUE');
  input.retainedTotalFen = '30000'; assert.equal(reviewPlatformCost(input, 50).coverageBps, '54');
  input.retainedTotalFen = '900719925474099300'; input.costs.bank.fen = '900719925474099300';
  assert.equal(reviewPlatformCost(input, 50).totalCostFen, '900719925474099360');
  assert.equal(reviewPlatformCost(input, 50).coverageBps, '10001');
});
