// Privileged finance tool only; never expose as a Mini Program action.
async function reviewTaxProfile(pool, input, operator, now = Date.now()) {
  const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
  const ref = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
  if (!id(input?.reviewId) || !id(input.profileVersionId)
    || !ref(input.withholdingEntityId, 64) || !ref(operator, 64)
    || !ref(input.evidenceReference, 128) || !['VERIFIED', 'REJECTED', 'REVOKED'].includes(input.decision)
    || input.decision === 'VERIFIED' && input.identityAndTaxTreatmentVerified !== true
    || !Number.isSafeInteger(now) || now < 0) throw Error('TAX_REVIEW_INPUT_INVALID');
  const connection = await pool.getConnection(); let reusable = true;
  try {
    await connection.beginTransaction();
    const [[profile]] = await connection.execute(`SELECT submission_id,appid,provider_id,review_status,CAST(created_at AS CHAR) AS created_at,
      CAST(reviewed_at AS CHAR) AS reviewed_at
      FROM provider_tax_profile_versions WHERE id=? AND withholding_entity_id=? FOR UPDATE`,
    [input.profileVersionId, input.withholdingEntityId]);
    if (!profile) throw Error('TAX_REVIEW_PROFILE_NOT_FOUND');
    if (input.decision === 'VERIFIED') {
      const [[source]] = await connection.execute(`SELECT id FROM provider_tax_submissions
        WHERE id=? AND withholding_entity_id=? AND appid=? AND provider_id=?`,
      [profile.submission_id, input.withholdingEntityId, profile.appid, profile.provider_id]);
      if (!source) throw Error('TAX_REVIEW_SUBMISSION_MISSING');
    }
    const [[previous]] = await connection.execute(`SELECT profile_version_id,to_status,reviewed_by,evidence_reference
      FROM provider_tax_profile_reviews WHERE id=?`, [input.reviewId]);
    if (previous) {
      if (previous.profile_version_id !== input.profileVersionId || previous.to_status !== input.decision
        || previous.reviewed_by !== operator || previous.evidence_reference !== input.evidenceReference) {
        throw Error('TAX_REVIEW_IDEMPOTENCY_MISMATCH');
      }
      await connection.commit();
      // A retry of an old approval never revives a subsequently revoked profile.
      return { reviewId: input.reviewId, decision: previous.to_status, currentStatus: profile.review_status };
    }
    const expected = input.decision === 'REVOKED' ? 'VERIFIED' : 'PENDING';
    if (profile.review_status !== expected || BigInt(now) < BigInt(profile.created_at)
      || profile.reviewed_at !== null && BigInt(now) < BigInt(profile.reviewed_at)) throw Error('TAX_REVIEW_STATE_CONFLICT');
    await connection.execute(`UPDATE provider_tax_profile_versions
      SET review_status=?,review_reference=?,reviewed_by=?,reviewed_at=? WHERE id=?`,
    [input.decision, input.evidenceReference, operator, now, input.profileVersionId]);
    await connection.execute(`INSERT INTO provider_tax_profile_reviews
      (id,profile_version_id,from_status,to_status,reviewed_by,evidence_reference,reviewed_at) VALUES(?,?,?,?,?,?,?)`,
    [input.reviewId, input.profileVersionId, expected, input.decision, operator, input.evidenceReference, now]);
    await connection.commit();
    return { reviewId: input.reviewId, decision: input.decision, currentStatus: input.decision };
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { reviewTaxProfile };
