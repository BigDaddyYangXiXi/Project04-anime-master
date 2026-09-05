const { loginAccount, readSession, registerAccount } = require("./identity-core");
const { loginByPhone, registerByPhone } = require("./phone-core");
const { createWxPhoneAdapter } = require("./wx-phone-adapter");

const PUBLIC_ERRORS = {
  ACCOUNT_CLOSED: "账号已注销，无法登录",
  ACCOUNT_NOT_REGISTERED: "当前微信身份尚未注册",
  ACCOUNT_NOTICE_REQUIRED: "请先确认账号标识和昵称用途",
  ACCOUNT_SUSPENDED: "账号已暂停使用，请联系平台",
  AUTH_CONTEXT_MISSING: "没有取得可信的小程序身份上下文",
  INVALID_NICKNAME: "昵称需为 1 至 20 个字符",
  ACCOUNT_LINK_CONFLICT: "当前微信身份已绑定其他账号，请联系平台处理",
  ACCOUNT_PHONE_ALREADY_BOUND: "当前账号已绑定其他手机号",
  PHONE_ALREADY_REGISTERED: "该手机号已注册，请切换到手机号登录",
  PHONE_CODE_MISSING: "未取得手机号授权凭证",
  PHONE_IDENTITY_NOT_CONFIGURED: "手机号登录暂未完成服务配置",
  PHONE_VERIFICATION_FAILED: "手机号验证失败，请重新授权"
};

function toPublicError(error) {
  const cause = error && error.code ? error.code : "UNEXPECTED";
  const code = PUBLIC_ERRORS[cause] ? cause : (cause === "UNSUPPORTED_ACTION" ? cause : "ACCOUNT_AUTH_FAILED");
  return {
    cause,
    code,
    message: PUBLIC_ERRORS[code] || (code === "UNSUPPORTED_ACTION" ? "不支持的账号操作" : "账号请求失败，请稍后重试")
  };
}

exports.main = async (event = {}, context) => {
  let stage = "LOAD_SDK";
  const action = event.action || "login";
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    stage = "READ_CALLER";
    const caller = cloudbase.getCloudbaseContext(context);
    const identity = {
      OPENID: caller.WX_OPENID || caller.OPENID,
      APPID: caller.WX_APPID || caller.APPID,
      UNIONID: caller.WX_UNIONID || caller.UNIONID
    };
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    let phoneApi;
    if (action === "phoneLogin" || action === "phoneRegister") {
      const wxCloud = require("wx-server-sdk");
      wxCloud.init({ env: wxCloud.DYNAMIC_CURRENT_ENV });
      phoneApi = createWxPhoneAdapter(wxCloud);
    }
    stage = "INIT_RDB";
    const db = app.rdb();
    stage = action === "register" || action === "phoneRegister" ? "REGISTER_ACCOUNT" : "READ_ACCOUNT";

    let data;
    if (action === "getSession") data = await readSession(db, identity);
    else if (action === "login") data = await loginAccount(db, identity);
    else if (action === "register") data = await registerAccount(db, identity, {
      nickname: event.nickname,
      acceptedNotice: event.acceptedNotice
    });
    else if (action === "phoneLogin") {
      const phoneInfo = await phoneApi.getPhoneNumber(event.phoneCode, identity.OPENID);
      data = await loginByPhone(db, identity, phoneInfo, process.env.ACCOUNT_PHONE_HASH_KEY);
    }
    else if (action === "phoneRegister") {
      const phoneInfo = await phoneApi.getPhoneNumber(event.phoneCode, identity.OPENID);
      data = await registerByPhone(db, identity, {
        nickname: event.nickname,
        acceptedNotice: event.acceptedNotice
      }, phoneInfo, process.env.ACCOUNT_PHONE_HASH_KEY);
    }
    else {
      const error = new Error("unsupported action");
      error.code = "UNSUPPORTED_ACTION";
      throw error;
    }

    console.info(JSON.stringify({
      scope: "account-bootstrap",
      action,
      outcome: data.registered ? "REGISTERED" : "NOT_REGISTERED",
      accountId: data.account ? data.account.id : null
    }));
    return { ok: true, data };
  } catch (error) {
    const publicError = toPublicError(error);
    const { cause, code } = publicError;
    console.error(JSON.stringify({ scope: "account-bootstrap", action, code, stage, cause }));
    return {
      ok: false,
      error: {
        code,
        message: publicError.message
      }
    };
  }
};

exports.toPublicError = toPublicError;
