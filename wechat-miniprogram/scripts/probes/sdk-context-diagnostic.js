// Temporary diagnostic: no identifiers, credentials, database, or external requests.
const instance = require('node:crypto').randomUUID();
let invocation = 0;
exports.main = async (_event, context) => {
  if (process.env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978') return { ok: false, code: 'TARGET_MISMATCH' };
  try {
    const sdk = require('@cloudbase/node-sdk');
    const parsed = sdk.parseContext(context);
    const request = parsed.environment || parsed.environ || {};
    const caller = sdk.getCloudbaseContext(context);
    const requestId = request.WX_OPENID || request.OPENID;
    const processId = process.env.WX_OPENID || process.env.OPENID;
    const sdkId = caller.WX_OPENID || caller.OPENID;
    return { ok: true, data: { instance, invocation: ++invocation, node: process.version,
      contextHasIdentity: Boolean(requestId), processHasIdentity: Boolean(processId), sdkHasIdentity: Boolean(sdkId),
      sdkMatchesContext: Boolean(requestId && sdkId === requestId),
      sdkMatchesProcess: Boolean(processId && sdkId === processId),
      contextCompanyApp: (request.WX_APPID || request.APPID) === 'wxc94e1c1b38944511',
      processCompanyApp: (process.env.WX_APPID || process.env.APPID) === 'wxc94e1c1b38944511' } };
  } catch (_) { return { ok: false, code: 'CONTEXT_DIAGNOSTIC_FAILED' }; }
};
