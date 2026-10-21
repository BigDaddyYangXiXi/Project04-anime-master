const { submitTaxProfile } = require('./tax-submission-store');
function fail(code) { const error = Error(code); error.code = code; throw error; }
async function submitOwnTaxProfile(pool, event, caller, config, env = process.env) {
  const openid = caller && (caller.WX_OPENID || caller.OPENID), appid = caller && (caller.WX_APPID || caller.APPID);
  if (typeof openid !== 'string' || !openid || typeof appid !== 'string' || !appid || appid !== config?.appid) fail('AUTH_CONTEXT_MISSING');
  const allowed = ['action','submissionId','entityType','legalName','documentType','documentNumber','issuingCountry','consent','noticeVersion'];
  if (!event || event.action !== 'submitTaxProfile' || Object.keys(event).some(k => !allowed.includes(k))) fail('TAX_SUBMISSION_INVALID');
  if (config.taxSubmissionEnabled !== true) fail('TAX_SUBMISSION_NOT_ENABLED');
  let privateConfig;
  try {
    if (env.TAX_PROFILE_CONFIG && env.TAX_PROFILE_CONFIG_B64) throw Error();
    privateConfig = JSON.parse(env.TAX_PROFILE_CONFIG_B64
      ? Buffer.from(env.TAX_PROFILE_CONFIG_B64, 'base64').toString('utf8') : env.TAX_PROFILE_CONFIG || 'null');
    if (!privateConfig || !/^[a-f0-9]{64}$/.test(privateConfig.encryptionKeyHex || '')
      || !/^[A-Za-z0-9_-]{1,64}$/.test(privateConfig.keyId || '')
      || !/^[A-Za-z0-9_-]{1,64}$/.test(privateConfig.noticeVersion || '')
      || !/^[A-Za-z0-9_-]{1,64}$/.test(config.taxWithholdingEntityId || '')) throw Error();
  } catch { fail('TAX_SUBMISSION_NOT_CONFIGURED'); }
  const key = Buffer.from(privateConfig.encryptionKeyHex, 'hex');
  if (config.apiV3Key && key.equals(Buffer.from(config.apiV3Key))) fail('TAX_SUBMISSION_NOT_CONFIGURED');
  const [[account]] = await pool.execute(`SELECT a.id FROM accounts a
    JOIN wechat_identities w ON w.account_id=a.id
    JOIN account_roles r ON r.account_id=a.id AND r.role='PROVIDER'
    WHERE a.status='ACTIVE' AND w.open_id=?`, [openid]);
  if (!account) fail('ACCOUNT_NOT_FOUND');
  try {
    return await submitTaxProfile(pool, { submissionId: event.submissionId,
      withholdingEntityId: config.taxWithholdingEntityId, appid, providerId: account.id }, event,
    { noticeVersion: privateConfig.noticeVersion, encryption: { keyId: privateConfig.keyId, key } });
  } catch (error) {
    if (['TAX_SUBMISSION_INVALID','TAX_SUBMISSION_CONFLICT'].includes(error.message)) fail(error.message);
    throw error;
  }
}
module.exports = { submitOwnTaxProfile };
