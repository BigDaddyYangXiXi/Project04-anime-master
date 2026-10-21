const { openTaxPayload } = require('../cloudfunctions/payment-api/tax-private-payload');
// Internal finance preparation after reviewing evidence. Never accepts a Mini Program event.
// taxpayerReference is an existing, verified internal mapping, not a supplied document number.
async function prepareTaxProfileReview(pool, scope, classification, encryption) {
  if (!/^[a-f0-9]{32}$/.test(scope?.submissionId || '')
    || ['withholdingEntityId','appid','providerId'].some(k => !/^[A-Za-z0-9_-]{1,64}$/.test(scope[k] || ''))
    || !/^[A-Za-z0-9_-]{1,64}$/.test(classification?.taxpayerReference || '')
    || !['RESIDENT','NON_RESIDENT','NOT_APPLICABLE'].includes(classification.taxResidency)
    || !['PLATFORM_LABOR','BUSINESS','COPYRIGHT','OTHER'].includes(classification.incomeNature)
    || !['validFromPeriod','validThroughPeriod'].every(k => /^\d{4}-(0[1-9]|1[0-2])$/.test(classification[k] || ''))
    || classification.validFromPeriod > classification.validThroughPeriod) throw Error('TAX_PREPARE_INVALID');
  const connection = await pool.getConnection(); let reusable = true;
  try {
    await connection.beginTransaction();
    const [[submission]] = await connection.execute(`SELECT encrypted_payload FROM provider_tax_submissions
      WHERE id=? AND withholding_entity_id=? AND appid=? AND provider_id=? FOR UPDATE`,
    [scope.submissionId, scope.withholdingEntityId, scope.appid, scope.providerId]);
    if (!submission) throw Error('TAX_SUBMISSION_NOT_FOUND');
    const envelope = typeof submission.encrypted_payload === 'string' ? JSON.parse(submission.encrypted_payload) : submission.encrypted_payload;
    const payload = openTaxPayload(envelope, scope, encryption);
    const [[binding]] = await connection.execute(`SELECT taxpayer_reference FROM taxpayer_submission_bindings
      WHERE submission_id=? AND withholding_entity_id=? FOR SHARE`, [scope.submissionId,scope.withholdingEntityId]);
    if (!binding) throw Error('TAX_IDENTITY_BINDING_REQUIRED');
    if (binding.taxpayer_reference !== classification.taxpayerReference) throw Error('TAX_PREPARE_CONFLICT');
    if (!['INDIVIDUAL','SOLE_PROPRIETOR','COMPANY'].includes(payload.entityType)
      || (payload.entityType === 'INDIVIDUAL') === (classification.taxResidency === 'NOT_APPLICABLE')) throw Error('TAX_PREPARE_CLASSIFICATION_INVALID');
    const expected = { taxpayer_reference: classification.taxpayerReference, entity_type: payload.entityType,
      tax_residency: classification.taxResidency, income_nature: classification.incomeNature,
      valid_from_period: classification.validFromPeriod, valid_through_period: classification.validThroughPeriod };
    const [[prior]] = await connection.execute('SELECT * FROM provider_tax_profile_versions WHERE submission_id=? FOR UPDATE', [scope.submissionId]);
    if (prior) {
      if (Object.entries(expected).some(([k,v]) => prior[k] !== v)) throw Error('TAX_PREPARE_CONFLICT');
      await connection.commit();
      return { profileVersionId: prior.id, status: prior.review_status };
    }
    // The submission id also serves as this single derived profile version id.
    await connection.execute(`INSERT INTO provider_tax_profile_versions
      (id,submission_id,withholding_entity_id,appid,provider_id,taxpayer_reference,entity_type,tax_residency,
       income_nature,review_status,valid_from_period,valid_through_period,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?,?)`,
    [scope.submissionId, scope.submissionId, scope.withholdingEntityId, scope.appid, scope.providerId,
      ...Object.values(expected).slice(0,4), classification.validFromPeriod, classification.validThroughPeriod, Date.now()]);
    await connection.commit();
    return { profileVersionId: scope.submissionId, status: 'PENDING' };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { prepareTaxProfileReview };
