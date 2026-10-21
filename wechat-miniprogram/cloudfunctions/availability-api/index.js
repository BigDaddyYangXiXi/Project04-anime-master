const { handleAvailability } = require("./availability-core");

exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = require('./request-context')(context);
    const openId = caller.WX_OPENID || caller.OPENID;
    if (event?.action !== "getPublic" && ((caller.WX_APPID || caller.APPID) !== "wxc94e1c1b38944511" || typeof openId !== "string" || !openId.trim())) {
      const error = new Error("trusted company identity required"); error.code = "AUTH_CONTEXT_MISSING"; throw error;
    }
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    return { ok: true, data: await handleAvailability(app.rdb(), event, caller) };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "PROVIDER_ROLE_REQUIRED", "INVALID_ACTION",
      "VALIDATION_ERROR", "VERSION_CONFLICT", "LOCKED_DATE_MUTATION", "TARGET_NOT_PUBLIC"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "AVAILABILITY_API_FAILED";
    console.error(JSON.stringify({ scope: "availability-api", code, cause: publicCodes.has(code) ? code : "UNEXPECTED" }));
    return { ok: false, error: { code, message: code === "AVAILABILITY_API_FAILED" ? "档期服务暂不可用，请稍后重试" : "档期请求未通过校验" } };
  }
};
