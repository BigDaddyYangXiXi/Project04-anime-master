const crypto = require('node:crypto');
// Preserve the existing import wire format while tolerating MySQL JSON object-key reordering.
const fields = ['resultId', 'batchId', 'sourceSha256', 'operatorId', 'evidenceReference',
  'records', 'status', 'payable', 'remainingChecks'];
const rowFields = ['orderId', 'paymentId', 'providerId', 'taxPeriod', 'providerPretaxFen',
  'incomeTaxFen', 'vatFen', 'surchargeFen', 'withholdingFen', 'providerNetFen', 'basisReference'];
function ordered(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw Error('FINANCE_IMPORT_SNAPSHOT_INVALID');
  }
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
function financeResultFingerprint(input) {
  const result = ordered(input, fields);
  if (!Array.isArray(result.records) || !result.records.length
    || result.records.some(row => typeof row?.paymentId !== 'string')) throw Error('FINANCE_IMPORT_SNAPSHOT_INVALID');
  result.records = result.records.map(row => ordered(row, rowFields))
    .sort((a, b) => a.paymentId < b.paymentId ? -1 : a.paymentId > b.paymentId ? 1 : 0);
  return crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
}
module.exports = { financeResultFingerprint };
