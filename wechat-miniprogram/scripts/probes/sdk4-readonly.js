// Temporary compatibility probe. Trusted identity only; no writes or OpenAPI calls.
exports.main = async (_event, context) => {
  let stage = 'environment';
  try {
    if (process.env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978') return { ok: false, code: 'TARGET_MISMATCH' };
    stage = 'sdk';
    const sdk = require('@cloudbase/node-sdk');
    stage = 'identity';
    const parsed = sdk.parseContext(context);
    const request = parsed.environment || parsed.environ || {};
    const requestOpenId = request.WX_OPENID || request.OPENID;
    if (!requestOpenId || (request.WX_APPID || request.APPID) !== 'wxc94e1c1b38944511') return { ok: false, code: 'AUTH_CONTEXT_MISSING' };
    const caller = sdk.getCloudbaseContext(context);
    const openId = caller.WX_OPENID || caller.OPENID;
    if (openId !== requestOpenId || (caller.WX_APPID || caller.APPID) !== 'wxc94e1c1b38944511') return { ok: false, code: 'AUTH_CONTEXT_MISSING' };
    const wechatSdk = require('wx-server-sdk');
    wechatSdk.init({ env: 'cloudbase-d2g65rqbvee0bd978' });
    const wxCaller = wechatSdk.getWXContext();
    if (wxCaller.OPENID !== openId || wxCaller.APPID !== 'wxc94e1c1b38944511') return { ok: false, code: 'SDK_IDENTITY_MISMATCH' };
    stage = 'database';
    const app = sdk.init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: 10000, retries: 0 });
    const result = await app.rdb().from('wechat_identities').select('account_id').eq('open_id', openId).limit(1);
    if (result?.error || !Array.isArray(result?.data)) return { ok: false, code: 'RDB_RESPONSE_INVALID' };
    return { ok: true, data: { node: process.version, sdk: require('@cloudbase/node-sdk/package.json').version,
      authenticated: true, sdkIdentitiesAgree: true, ownIdentityRows: result.data.length, readOnly: true } };
  } catch (_) { return { ok: false, code: 'SDK_COMPATIBILITY_FAILED', stage }; }
};
