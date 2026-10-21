// Consume a server-reviewed profile, never a client-selected identity alone.
function providerTaxTreatment(profile = {}) {
  const pending = reason => ({ status: 'REVIEW_REQUIRED', reason, calculationType: null, payable: false });
  if (profile.reviewStatus !== 'VERIFIED' || typeof profile.reviewReference !== 'string'
    || !profile.reviewReference.trim()) return pending('IDENTITY_OR_TAX_REVIEW_MISSING');
  if (profile.entityType === 'INDIVIDUAL') {
    if (!['RESIDENT', 'NON_RESIDENT'].includes(profile.taxResidency)) return pending('TAX_RESIDENCY_UNCONFIRMED');
    if (profile.incomeNature !== 'PLATFORM_LABOR') return pending('INCOME_NATURE_REQUIRES_REVIEW');
    if (profile.taxResidency === 'NON_RESIDENT') return pending('NON_RESIDENT_RULE_NOT_IMPLEMENTED');
    return { status: 'CALCULATION_SUPPORTED', calculationType: 'RESIDENT_PLATFORM_LABOR', payable: false };
  }
  if (['SOLE_PROPRIETOR', 'COMPANY'].includes(profile.entityType)) {
    return pending('BUSINESS_TAX_AND_INVOICE_REVIEW_REQUIRED');
  }
  return pending('ENTITY_TYPE_UNCONFIRMED');
}
module.exports = { providerTaxTreatment };
