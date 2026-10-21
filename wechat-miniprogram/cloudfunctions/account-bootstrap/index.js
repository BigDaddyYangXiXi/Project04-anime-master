const { loginAccount, readSession, identityKey, normalizeNickname, NOTICE_VERSION } = require("./identity-core");
const { checkNames } = require('./account-names');
const { reviewNickname } = require("./nickname-security");
const { loginByPhone, registerByPhone } = require("./phone-core");
const { createWxPhoneAdapter } = require("./wx-phone-adapter");
const ACTIONS = new Set(["login", "getSession", "register", "checkRegistration", "phoneLogin", "phoneRegister"]);

const PUBLIC_ERRORS = {
  INVALID_USERNAME: "用户名需为2至12个字符，只能包含英文字母、数字和英文标点符号",
  NICKNAME_TAKEN: "这个昵称已被使用，请换一个",
  USERNAME_TAKEN: "这个用户名已被使用，请换一个",
  PHONE_AUTH_REQUIRED: "请更新小程序，并授权微信手机号完成注册",
  REGISTRATION_CONFLICT: "注册资料与上次提交不一致，请恢复上次资料后重试或联系客服",
  ACCOUNT_NOTICE_OUTDATED: "注册协议已更新，请重新阅读并确认",
  NICKNAME_REJECTED: "昵称含不适宜内容，请修改后重试",
  NICKNAME_REVIEW_REQUIRED: "昵称暂未通过审核，请修改后重试",
  NICKNAME_CHECK_UNAVAILABLE: "暂时无法校验昵称，请稍后重试",
  ACCOUNT_CLOSED: "账号已注销，无法登录",
  ACCOUNT_NOT_REGISTERED: "当前微信身份尚未注册",
  ACCOUNT_NOTICE_REQUIRED: "请先确认账号标识和昵称用途",
  ACCOUNT_SUSPENDED: "账号已暂停使用，请联系平台",
  AUTH_CONTEXT_MISSING: "没有取得可信的小程序身份上下文",
  INVALID_NICKNAME: "昵称需为 1 至 12 个字符",
  ACCOUNT_LINK_CONFLICT: "当前微信身份已绑定其他账号，请联系平台处理",
  ACCOUNT_PHONE_ALREADY_BOUND: "当前账号已绑定其他手机号",
  PHONE_ALREADY_REGISTERED: "该手机号已注册，请切换到手机号登录",
  PHONE_CODE_MISSING: "未取得手机号授权凭证",
  PHONE_IDENTITY_NOT_CONFIGURED: "手机号登录暂未完成服务配置",
  PHONE_VERIFICATION_FAILED: "手机号验证失败，请重新授权"
};

function toPublicError(error) {
  const supplied = error && error.code;
  const cause = typeof supplied === "string" && (Object.hasOwn(PUBLIC_ERRORS, supplied) || supplied === "UNSUPPORTED_ACTION") ? supplied : "UNEXPECTED";
  const code = Object.hasOwn(PUBLIC_ERRORS, cause) ? cause : (cause === "UNSUPPORTED_ACTION" ? cause : "ACCOUNT_AUTH_FAILED");
  return {
    cause,
    code,
    message: PUBLIC_ERRORS[code] || (code === "UNSUPPORTED_ACTION" ? "不支持的账号操作" : "账号请求失败，请稍后重试")
  };
}

exports.main = async (event = {}, context) => {
  const started = Date.now();
  let stage = "VALIDATE_ACTION";
  const requested = event && typeof event === "object" && !Array.isArray(event) ? event.action ?? "login" : null;
  const action = ACTIONS.has(requested) ? requested : requested === "" ? "login" : "unsupported";
  try {
    if (action === "unsupported") {
      const error = new Error("unsupported action"); error.code = "UNSUPPORTED_ACTION"; throw error;
    }
    stage = "LOAD_SDK";
    const cloudbase = require("@cloudbase/node-sdk");
    const loaded = Date.now();
    stage = "READ_CALLER";
    const caller = require('./request-context')(context);
    const identity = {
      OPENID: caller.WX_OPENID || caller.OPENID,
      APPID: caller.WX_APPID || caller.APPID,
      UNIONID: caller.WX_UNIONID || caller.UNIONID
    };
    if (identity.APPID !== 'wxc94e1c1b38944511' || typeof identity.OPENID !== 'string' || !identity.OPENID.trim()) {
      const error = new Error('trusted company identity required'); error.code = 'AUTH_CONTEXT_MISSING'; throw error;
    }
    if (action === 'register') { const error = new Error('phone required'); error.code = 'PHONE_AUTH_REQUIRED'; throw error; }
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const db = app.rdb();
    const initialized = Date.now();
    let phoneApi;
    if (action === "checkRegistration" || action === "phoneRegister") {
      if (event.acceptedNotice !== true) {
        const error = new Error("notice required"); error.code = "ACCOUNT_NOTICE_REQUIRED"; throw error;
      }
      if (event.noticeVersion !== NOTICE_VERSION) {
        const error = new Error("agreement version changed"); error.code = "ACCOUNT_NOTICE_OUTDATED"; throw error;
      }
      stage = "CHECK_NICKNAME";
      const link = await db.from('wechat_identities').select('account_id').eq('open_id', identity.OPENID);
      if (link.error) throw new Error('identity lookup failed');
      const accountId = link.data?.[0]?.account_id || `acct_${identityKey(identity.APPID, identity.OPENID).slice(0, 32)}`;
      await checkNames(db, normalizeNickname(event.nickname), event.username, accountId);
      await reviewNickname(normalizeNickname(event.nickname), identity.OPENID);
    }
    if (action === "phoneLogin" || action === "phoneRegister") {
      const wxCloud = require("wx-server-sdk");
      wxCloud.init({ env: wxCloud.DYNAMIC_CURRENT_ENV });
      phoneApi = createWxPhoneAdapter(wxCloud);
    }
    stage = "INIT_RDB";
    stage = action === "register" || action === "phoneRegister" ? "REGISTER_ACCOUNT" : "READ_ACCOUNT";

    let data;
    if (action === "getSession") data = await readSession(db, identity);
    else if (action === "login") data = await loginAccount(db, identity);
    else if (action === "checkRegistration") data = { available: true };
    else if (action === "phoneLogin") {
      const phoneInfo = await phoneApi.getPhoneNumber(event.phoneCode, identity.OPENID);
      data = await loginByPhone(db, identity, phoneInfo, process.env.ACCOUNT_PHONE_HASH_KEY);
    }
    else if (action === "phoneRegister") {
      const phoneInfo = await phoneApi.getPhoneNumber(event.phoneCode, identity.OPENID);
      data = await registerByPhone(db, identity, {
        nickname: event.nickname,
        username: event.username,
        acceptedNotice: event.acceptedNotice,
      noticeVersion: event.noticeVersion
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
    return { ok: true, data, ...(action === "getSession" ? { serverTiming: {
      sdkLoadMs: loaded - started, initMs: initialized - loaded, readMs: Date.now() - initialized
    } } : {}) };
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
