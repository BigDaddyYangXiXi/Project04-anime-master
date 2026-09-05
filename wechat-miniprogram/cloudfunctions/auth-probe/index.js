const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext();

  if (!OPENID || !APPID) {
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
      hasUnionId: Boolean(UNIONID)
    }
  };
};
