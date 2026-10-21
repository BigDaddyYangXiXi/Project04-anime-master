const crypto = require('node:crypto');
const { openTaxPayload } = require('../cloudfunctions/payment-api/tax-private-payload');
// Restricted back-office call after evidence verification, never a Mini Program action.
// verifiedIdentity is a canonical tax identity from the reviewer, not arbitrary document text.
async function bindTaxpayerIdentity(pool, scope, verification, encryption, indexKey) {
  if (!/^[a-f0-9]{32}$/.test(scope?.submissionId || '')
    || ['withholdingEntityId','appid','providerId'].some(k => !/^[A-Za-z0-9_-]{1,64}$/.test(scope[k] || ''))
    || verification?.identityVerified !== true
    || !/^[A-Za-z0-9_-]{1,64}$/.test(verification.operator || '')
    || typeof verification.evidenceReference !== 'string' || !verification.evidenceReference.trim()
    || verification.evidenceReference.length > 128
    || !Buffer.isBuffer(indexKey) || indexKey.length !== 32
    || indexKey.equals(encryption?.key || Buffer.alloc(0))) throw Error('TAX_BINDING_INVALID');
  const identity = verification.verifiedIdentity;
  // Deliberately no guessed case folding or document conversions. Reviewer supplies canonical values.
  if (!identity || ['jurisdiction','identifierType','identifier'].some(k =>
    typeof identity[k] !== 'string' || !identity[k] || identity[k] !== identity[k].trim()
    || identity[k].length > 128 || /[\u0000-\u001f\u007f]/.test(identity[k]))) throw Error('TAX_BINDING_INVALID');
  const digest = crypto.createHmac('sha256',indexKey).update(JSON.stringify([
    'TAX_IDENTITY_V1',scope.withholdingEntityId,identity.jurisdiction,identity.identifierType,identity.identifier
  ])).digest('hex');
  const fingerprint = crypto.createHmac('sha256',indexKey).update('TAX_INDEX_KEY_V1').digest('hex');
  const connection = await pool.getConnection(); let reusable = true;
  try {
    await connection.beginTransaction();
    const [[submission]] = await connection.execute(`SELECT encrypted_payload FROM provider_tax_submissions
      WHERE id=? AND withholding_entity_id=? AND appid=? AND provider_id=? FOR UPDATE`,
    [scope.submissionId,scope.withholdingEntityId,scope.appid,scope.providerId]);
    if (!submission) throw Error('TAX_SUBMISSION_NOT_FOUND');
    openTaxPayload(typeof submission.encrypted_payload === 'string' ? JSON.parse(submission.encrypted_payload) : submission.encrypted_payload,scope,encryption);
    await connection.execute(`INSERT INTO taxpayer_index_keys(withholding_entity_id,key_fingerprint)
      VALUES(?,?) ON DUPLICATE KEY UPDATE withholding_entity_id=withholding_entity_id`,[scope.withholdingEntityId,fingerprint]);
    const [[key]] = await connection.execute('SELECT key_fingerprint FROM taxpayer_index_keys WHERE withholding_entity_id=? FOR UPDATE',[scope.withholdingEntityId]);
    if (key.key_fingerprint !== fingerprint) throw Error('TAX_INDEX_KEY_CHANGED');
    await connection.execute(`INSERT INTO taxpayer_identities(id,withholding_entity_id,identity_digest)
      VALUES(?,?,?) ON DUPLICATE KEY UPDATE id=id`,[crypto.randomBytes(16).toString('hex'),scope.withholdingEntityId,digest]);
    const [[person]] = await connection.execute('SELECT id FROM taxpayer_identities WHERE withholding_entity_id=? AND identity_digest=?',[scope.withholdingEntityId,digest]);
    const [[prior]] = await connection.execute('SELECT * FROM taxpayer_submission_bindings WHERE submission_id=? FOR UPDATE',[scope.submissionId]);
    if (prior && (prior.taxpayer_reference !== person.id || prior.verified_by !== verification.operator
      || prior.evidence_reference !== verification.evidenceReference)) throw Error('TAX_BINDING_CONFLICT');
    if (!prior) await connection.execute(`INSERT INTO taxpayer_submission_bindings
      (submission_id,withholding_entity_id,taxpayer_reference,verified_by,evidence_reference,verified_at) VALUES(?,?,?,?,?,?)`,
    [scope.submissionId,scope.withholdingEntityId,person.id,verification.operator,verification.evidenceReference,Date.now()]);
    await connection.commit();
    return { taxpayerReference:person.id,submissionId:scope.submissionId };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { bindTaxpayerIdentity };
