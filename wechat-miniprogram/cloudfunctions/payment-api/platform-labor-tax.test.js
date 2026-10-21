const test = require('node:test');
const assert = require('node:assert/strict');
const { previewPlatformLaborTax: preview } = require('./platform-labor-tax');
function input(patch = {}) {
  return { incomeType: 'RESIDENT_PLATFORM_LABOR', period: '2026-09', eligibleMonths: 1,
    cumulativeIncomeFen: '1000000', cumulativeExemptIncomeFen: '0',
    cumulativeOtherDeductionFen: '0', cumulativeTaxReductionFen: '0', cumulativeWithheldFen: '0', ...patch };
}
test('10000 yuan confirmed income gives 90 yuan, not a flat 20 percent tax', () => {
  const result = preview(input());
  assert.equal(result.currentWithholdingFen, '9000');
  assert.equal(result.payable, false);
});
test('6250 yuan for one eligible month has zero prepayment', () => {
  assert.equal(preview(input({ cumulativeIncomeFen: '625000' })).currentWithholdingFen, '0');
});
test('same-month cumulative withholding subtracts prior withholding once', () => {
  const first = preview(input({ cumulativeIncomeFen: '700000' }));
  const second = preview(input({ cumulativeWithheldFen: first.currentWithholdingFen }));
  assert.equal(BigInt(first.currentWithholdingFen) + BigInt(second.currentWithholdingFen), 9000n);
});
test('additional eligible months can lower liability but cannot automatically refund', () => {
  const result = preview(input({ eligibleMonths: 2, cumulativeWithheldFen: '9000' }));
  assert.equal(result.currentWithholdingFen, '0'); assert.equal(result.excessWithheldFen, '9000');
});
test('all bracket boundaries and next-fen rate selection', () => {
  for (const [base, expectedTax, rate, nextRate] of [
    [3600000n, '108000', 3, 10], [14400000n, '1188000', 10, 20],
    [30000000n, '4308000', 20, 25], [42000000n, '7308000', 25, 30],
    [66000000n, '14508000', 30, 35], [96000000n, '25008000', 35, 45]
  ]) {
    const gross = (base + 500000n) * 5n / 4n;
    const result = preview(input({ cumulativeIncomeFen: gross.toString() }));
    assert.equal(result.cumulativeTaxFen, expectedTax); assert.equal(result.ratePercent, rate);
    assert.equal(preview(input({ cumulativeIncomeFen: (gross + 1n).toString() })).ratePercent, nextRate);
  }
});
test('explicit lawful deductions and tax reductions are separate from commission', () => {
  assert.equal(preview(input({ cumulativeExemptIncomeFen: '100000', cumulativeOtherDeductionFen: '100000',
    cumulativeTaxReductionFen: '1000' })).currentWithholdingFen, '2000');
});
test('unknown inputs, unsupported classifications and invalid periods fail closed', () => {
  for (const patch of [{ cumulativeWithheldFen: undefined }, { cumulativeIncomeFen: 1000000 },
    { cumulativeIncomeFen: '-1' }, { incomeType: 'BUSINESS' }, { incomeType: 'NON_RESIDENT' },
    { period: '2025-09' }, { period: '2026-13' }, { eligibleMonths: 10 }, { eligibleMonths: 0 },
    { cumulativeExemptIncomeFen: '1000001' }]) assert.throws(() => preview(input(patch)), /TAX_/);
});
test('large monetary strings preserve precision and fractional tax rounds only at final fen', () => {
  assert.match(preview(input({ cumulativeIncomeFen: '9007199254740993' })).currentWithholdingFen, /^\d+$/);
  assert.equal(preview(input({ cumulativeIncomeFen: '625020' })).currentWithholdingFen, '0');
  assert.equal(preview(input({ cumulativeIncomeFen: '625021' })).currentWithholdingFen, '1');
});
