function fail(code) { const error = Error(code); error.code = code; throw error; }
// Only the signed caller's latest submission state; never decrypts private data.
async function readTaxProfileStatus(pool, event, caller, config) {
  const openid = caller && (caller.WX_OPENID || caller.OPENID);
  const appid = caller && (caller.WX_APPID || caller.APPID);
  if (typeof openid !== 'string' || !openid || typeof appid !== 'string' || !appid || appid !== config?.appid) fail('AUTH_CONTEXT_MISSING');
  if (!event || event.action !== 'getTaxProfileStatus' || Object.keys(event).some(k => k !== 'action')) fail('TAX_STATUS_INPUT_INVALID');
  if (typeof config.taxWithholdingEntityId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(config.taxWithholdingEntityId)) fail('TAX_STATUS_NOT_CONFIGURED');
  const [[row]] = await pool.execute(`SELECT a.id AS owner_id,s.id AS submission_id,p.id AS profile_version_id,
    p.review_status,p.entity_type,p.tax_residency,p.valid_from_period,p.valid_through_period
    FROM accounts a JOIN wechat_identities w ON w.account_id=a.id
    JOIN account_roles r ON r.account_id=a.id AND r.role='PROVIDER'
    LEFT JOIN provider_tax_submissions s ON s.provider_id=a.id AND s.appid=? AND s.withholding_entity_id=?
    LEFT JOIN provider_tax_profile_versions p ON p.submission_id=s.id AND p.provider_id=a.id
      AND p.appid=s.appid AND p.withholding_entity_id=s.withholding_entity_id
    WHERE a.status='ACTIVE' AND w.open_id=? ORDER BY s.submitted_at DESC,s.id DESC LIMIT 1`,
  [appid, config.taxWithholdingEntityId, openid]);
  if (!row) fail('ACCOUNT_NOT_FOUND');
  if (!row.submission_id) return { status: 'NOT_SUBMITTED' };
  return { submissionId: row.submission_id, profileVersionId: row.profile_version_id || null,
    status: row.review_status || 'SUBMITTED', entityType: row.entity_type || null,
    taxResidency: row.tax_residency || null,
    validFromPeriod: row.valid_from_period || null, validThroughPeriod: row.valid_through_period || null };
}
module.exports = { readTaxProfileStatus };
