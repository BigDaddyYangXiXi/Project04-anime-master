const test = require('node:test');
const assert = require('node:assert/strict');
const { providerTaxTreatment: classify } = require('./provider-tax-treatment');
const { previewProviderTax } = require('./platform-labor-tax');
const verified = { reviewStatus: 'VERIFIED', reviewReference: 'review-1', entityType: 'INDIVIDUAL',
  taxResidency: 'RESIDENT', incomeNature: 'PLATFORM_LABOR' };
test('only reviewed resident platform labor reaches the cumulative calculator', () => {
  const result = previewProviderTax(verified, { period: '2026-09', eligibleMonths: 1,
    cumulativeIncomeFen: '1000000', cumulativeExemptIncomeFen: '0', cumulativeOtherDeductionFen: '0',
    cumulativeTaxReductionFen: '0', cumulativeWithheldFen: '0' });
  assert.equal(result.currentWithholdingFen, '9000'); assert.equal(result.payable, false);
});
test('self-declared identity and a certificate do not establish tax residency', () => {
  for (const patch of [{ reviewStatus: 'PENDING' }, { reviewReference: '' },
    { taxResidency: undefined, certificateType: 'CHINESE_ID' }]) {
    assert.equal(classify({ ...verified, ...patch }).status, 'REVIEW_REQUIRED');
  }
});
test('business, nonresident and copyright income never silently use zero tax or resident labor', () => {
  for (const patch of [{ entityType: 'SOLE_PROPRIETOR' }, { entityType: 'COMPANY' },
    { taxResidency: 'NON_RESIDENT' }, { incomeNature: 'COPYRIGHT' }, { entityType: 'UNKNOWN' }]) {
    const result = previewProviderTax({ ...verified, ...patch }, {});
    assert.equal(result.status, 'REVIEW_REQUIRED'); assert.equal(result.payable, false);
    assert.equal(result.currentWithholdingFen, undefined);
  }
});
