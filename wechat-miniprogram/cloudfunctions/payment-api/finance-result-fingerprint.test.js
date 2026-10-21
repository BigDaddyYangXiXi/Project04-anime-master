const { test } = require('node:test');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { financeResultFingerprint } = require('./finance-result-fingerprint');
const fixture = () => ({ resultId: 'result', batchId: 'batch', sourceSha256: 'a'.repeat(64), operatorId: 'finance',
  evidenceReference: 'test', records: [{ orderId: 'order', paymentId: 'payment', providerId: 'provider', taxPeriod: '2026-09',
    providerPretaxFen: '8000', incomeTaxFen: '100', vatFen: '0', surchargeFen: '0', withholdingFen: '100',
    providerNetFen: '7900', basisReference: 'test' }], status: 'VALIDATED_DRAFT', payable: false,
  remainingChecks: ['LIVE_SOURCE_AND_HOLD_RECHECK', 'AUTHORIZED_FINANCE_APPROVAL', 'ATOMIC_NET_LEDGER_CREDIT'] });
test('fingerprint preserves the prior import hash and tolerates MySQL object-key order', () => {
  const value = fixture(), expected = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const reverse = v => Object.fromEntries(Object.entries(v).reverse());
  assert.equal(financeResultFingerprint(value), expected);
  value.records = value.records.map(reverse);
  assert.equal(financeResultFingerprint(reverse(value)), expected);
});
test('financial evidence changes and field types cannot retain the original fingerprint', () => {
  const original = fixture(), hash = financeResultFingerprint(original);
  for (const change of [{ providerNetFen: '7901', incomeTaxFen: '99', withholdingFen: '99' },
    { providerNetFen: 7900 }, { providerId: 'foreign' }, { basisReference: 'changed' }]) {
    const value = fixture(); Object.assign(value.records[0], change);
    assert.notEqual(financeResultFingerprint(value), hash);
  }
});
test('missing, unknown and malformed fields fail without disclosing their contents', () => {
  for (const value of [null, {}, { ...fixture(), records: null }, { ...fixture(), records: [] },
    { ...fixture(), secret: 'do-not-print' }, { ...fixture(), records: [{ ...fixture().records[0], secret: 'do-not-print' }] }]) {
    assert.throws(() => financeResultFingerprint(value), /^Error: FINANCE_IMPORT_SNAPSHOT_INVALID$/);
  }
});
