const { isDeepStrictEqual } = require('node:util');
const { sealTaxPayload, openTaxPayload } = require('./tax-private-payload');
// Internal store. scope must come from authenticated server identity; not an event body.
// No automatic creation of a verified tax profile or taxpayer mapping.
async function submitTaxProfile(pool, scope, input, config) {
  if (!/^[a-f0-9]{32}$/.test(scope?.submissionId || '') || !input || input.consent !== true
    || typeof config?.noticeVersion !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(config.noticeVersion)
    || input.noticeVersion !== config.noticeVersion
    || !['INDIVIDUAL','SOLE_PROPRIETOR','COMPANY'].includes(input.entityType)) throw Error('TAX_SUBMISSION_INVALID');
  for (const field of ['legalName', 'documentType', 'documentNumber', 'issuingCountry']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 128
      || /[\u0000-\u001f\u007f]/.test(input[field])) throw Error('TAX_SUBMISSION_INVALID');
  }
  const payload = Object.fromEntries(['entityType','legalName','documentType','documentNumber','issuingCountry']
    .map(field => [field, input[field].trim()]));
  // Do not infer tax residency from the document or country; review collects it separately.
  const envelope = sealTaxPayload(payload, scope, config.encryption);
  const connection = await pool.getConnection(); let reusable = true;
  try {
    await connection.beginTransaction();
    await connection.execute(`INSERT INTO provider_tax_submissions
      (id,withholding_entity_id,appid,provider_id,encrypted_payload,notice_version,submitted_at)
      VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
    [scope.submissionId, scope.withholdingEntityId, scope.appid, scope.providerId, JSON.stringify(envelope), config.noticeVersion, Date.now()]);
    const [[row]] = await connection.execute(`SELECT encrypted_payload,notice_version FROM provider_tax_submissions
      WHERE id=? AND withholding_entity_id=? AND appid=? AND provider_id=? FOR UPDATE`,
    [scope.submissionId, scope.withholdingEntityId, scope.appid, scope.providerId]);
    if (!row) throw Error('TAX_SUBMISSION_CONFLICT');
    const stored = typeof row.encrypted_payload === 'string' ? JSON.parse(row.encrypted_payload) : row.encrypted_payload;
    if (row.notice_version !== config.noticeVersion || !isDeepStrictEqual(openTaxPayload(stored, scope, config.encryption), payload)) {
      throw Error('TAX_SUBMISSION_CONFLICT');
    }
    await connection.commit();
    return { submissionId: scope.submissionId, status: 'SUBMITTED', verified: false };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { submitTaxProfile };
