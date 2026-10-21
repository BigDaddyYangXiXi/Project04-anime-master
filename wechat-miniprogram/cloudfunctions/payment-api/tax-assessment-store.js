const crypto = require('node:crypto');
const { previewProviderTax } = require('./platform-labor-tax');
// Internal draft writer only. Identity references must be server-resolved opaque IDs.
// This persists the exact calculation inputs, not a trusted annual ledger or funds.
async function saveTaxAssessmentDraft(pool, scope, input) {
  for (const [key, max] of [['withholdingEntityId', 64], ['settlementReference', 128], ['appid', 64], ['providerId', 64]]) {
    if (typeof scope?.[key] !== 'string' || !new RegExp(`^[A-Za-z0-9_:-]{1,${max}}$`).test(scope[key])) {
      throw Error('TAX_DRAFT_SCOPE_INVALID');
    }
  }
  if (!/^[a-f0-9]{32}$/.test(scope.profileVersionId || '') || !input) throw Error('TAX_DRAFT_SCOPE_INVALID');
  const connection = await pool.getConnection(); let reusable = true;
  try {
    await connection.beginTransaction();
    const [[profile]] = await connection.execute(`SELECT taxpayer_reference AS taxpayerReference,
      review_status AS reviewStatus,review_reference AS reviewReference,entity_type AS entityType,
      tax_residency AS taxResidency,income_nature AS incomeNature
      FROM provider_tax_profile_versions WHERE id=? AND withholding_entity_id=? AND appid=? AND provider_id=?
      AND valid_from_period<=? AND valid_through_period>=? FOR SHARE`,
    [scope.profileVersionId, scope.withholdingEntityId, scope.appid, scope.providerId, input.period, input.period]);
    if (!profile) throw Error('TAX_PROFILE_NOT_FOUND_OR_EXPIRED');
    const result = previewProviderTax(profile, input);
    if (result.scope !== 'PREVIEW_ONLY') throw Error('TAX_DRAFT_REVIEW_REQUIRED');
    // Canonical allowed fields: object key order and extraneous caller data cannot alter identity.
    const snapshot = {
      taxpayerReference: profile.taxpayerReference,
      profileVersionId: scope.profileVersionId, appid: scope.appid, providerId: scope.providerId,
      profile: Object.fromEntries(['reviewStatus', 'reviewReference', 'entityType', 'taxResidency', 'incomeNature']
        .map(key => [key, profile[key]])),
      input: Object.fromEntries(['period', 'eligibleMonths', 'cumulativeIncomeFen', 'cumulativeExemptIncomeFen',
        'cumulativeOtherDeductionFen', 'cumulativeTaxReductionFen', 'cumulativeWithheldFen'].map(key => [key, input[key]])),
      ruleVersion: result.ruleVersion
    };
    const json = JSON.stringify(snapshot);
    const hash = crypto.createHash('sha256').update(json).digest('hex');
    // Unique source key serializes concurrent retries without rewriting the first snapshot.
    await connection.execute(`INSERT INTO tax_assessment_drafts
      (id,withholding_entity_id,settlement_reference,taxpayer_reference,tax_period,rule_version,
       input_sha256,calculation_input,calculation_result,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`,
    [crypto.randomBytes(16).toString('hex'), scope.withholdingEntityId, scope.settlementReference,
      profile.taxpayerReference, input.period, result.ruleVersion, hash, json, JSON.stringify(result), Date.now()]);
    const [[row]] = await connection.execute(`SELECT id,input_sha256,calculation_result FROM tax_assessment_drafts
      WHERE withholding_entity_id=? AND settlement_reference=? FOR UPDATE`,
    [scope.withholdingEntityId, scope.settlementReference]);
    if (!row || row.input_sha256 !== hash) throw Error('TAX_DRAFT_IDEMPOTENCY_MISMATCH');
    await connection.commit();
    return { id: row.id, status: 'CALCULATED_DRAFT', payable: false,
      calculation: typeof row.calculation_result === 'string' ? JSON.parse(row.calculation_result) : row.calculation_result };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { saveTaxAssessmentDraft };
