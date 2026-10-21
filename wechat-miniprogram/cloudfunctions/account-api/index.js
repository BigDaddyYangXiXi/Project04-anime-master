const { handleAccount } = require("./account-core");
const { reviewNickname } = require("./nickname-security");
const { resolvedRegion, geocoderUrl } = require("./location-resolver");

async function resolveRegion(latitude, longitude) {
  const key = String(process.env.TENCENT_MAP_KEY || "").trim();
  const secret = String(process.env.TENCENT_MAP_SK || "").trim();
  if (!key || !secret) { const error = new Error("map credentials are not configured"); error.code = "LOCATION_SERVICE_NOT_CONFIGURED"; throw error; }
  const url = geocoderUrl(latitude, longitude, key, secret);
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const value = await response.json();
  const region = resolvedRegion(value);
  if (!response.ok || !region) {
    console.error(JSON.stringify({ scope: "map-resolution", httpStatus: response.status, mapStatus: Number.isInteger(value && value.status) ? value.status : null }));
    const error = new Error("location resolution failed"); error.code = "LOCATION_RESOLUTION_FAILED"; throw error;
  }
  return region;
}

exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = require('./request-context')(context);
    const openId = caller.WX_OPENID || caller.OPENID;
    if ((caller.WX_APPID || caller.APPID) !== "wxc94e1c1b38944511" || typeof openId !== "string" || !openId.trim()) {
      const error = new Error("trusted company identity required"); error.code = "AUTH_CONTEXT_MISSING"; throw error;
    }
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const data = await handleAccount(app.rdb(), event, caller, Date.now(), { resolveRegion, reviewNickname });
    if (data.contentIntent) await require("./content-intents").wake(app, data.contentIntent.id);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set(["AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "INVALID_ACTION", "VALIDATION_ERROR", "VERSION_CONFLICT", "AVATAR_NOT_READY", "LOCATION_SERVICE_NOT_CONFIGURED", "LOCATION_RESOLUTION_FAILED"]);
    const nicknameMessages = { NICKNAME_TAKEN: "这个昵称已被使用，请换一个", NICKNAME_REJECTED: "昵称含不适宜内容，请修改后重试", NICKNAME_REVIEW_REQUIRED: "昵称暂未通过审核，请修改后重试", NICKNAME_CHECK_UNAVAILABLE: "暂时无法校验昵称，请稍后重试" };
    Object.keys(nicknameMessages).forEach((code) => publicCodes.add(code));
    const code = publicCodes.has(error && error.code) ? error.code : "ACCOUNT_API_FAILED";
    console.error(JSON.stringify({ scope: "account-api", code, cause: publicCodes.has(code) ? code : "UNEXPECTED" }));
    return { ok: false, error: { code, message: nicknameMessages[code] || (code === "ACCOUNT_API_FAILED" ? "账号服务暂不可用，请稍后重试" : "账号请求未通过校验") } };
  }
};
