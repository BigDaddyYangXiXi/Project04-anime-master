exports.main = async (_event, context) => {
  const caller = require('./request-context')(context);
  const OPENID = caller.WX_OPENID || caller.OPENID;
  const APPID = caller.WX_APPID || caller.APPID;
  const UNIONID = caller.WX_UNIONID || caller.UNIONID;

  if (!OPENID || APPID !== 'wxc94e1c1b38944511') {
    return {
      ok: false,
      error: {
        code: "AUTH_CONTEXT_MISSING",
        message: "没有取得可信的小程序身份上下文"
      }
    };
  }

  console.info(JSON.stringify({
    scope: "auth-probe",
    action: "WECHAT_IDENTITY_VERIFIED",
    appId: APPID,
    hasUnionId: Boolean(UNIONID)
  }));

  return {
    ok: true,
    data: {
      authenticated: true,
      appId: APPID,
      hasUnionId: Boolean(UNIONID)
    }
  };
};
