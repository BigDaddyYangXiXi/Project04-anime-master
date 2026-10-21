const { handleProject } = require("./project-core");

exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = require('./request-context')(context);
    const openId = caller.WX_OPENID || caller.OPENID;
    if ((caller.WX_APPID || caller.APPID) !== "wxc94e1c1b38944511" || typeof openId !== "string" || !openId.trim()) {
      const error = new Error("trusted company identity required"); error.code = "AUTH_CONTEXT_MISSING"; throw error;
    }
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const data = await handleProject(app.rdb(), event, caller, Date.now(), undefined, app);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "BUYER_ROLE_REQUIRED", "INVALID_ACTION", "VALIDATION_ERROR",
      "PROJECT_NOT_FOUND", "VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "ORDER_NOT_ELIGIBLE",
      "ORDER_ALREADY_LINKED", "ORDER_NOT_LINKED", "PROJECT_MEDIA_NOT_READY"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "PROJECT_API_FAILED";
    console.error(JSON.stringify({ scope: "project-api", code, cause: publicCodes.has(code) ? code : "UNEXPECTED" }));
    return { ok: false, error: { code, message: code === "PROJECT_API_FAILED" ? "项目服务暂不可用，请稍后重试" : "项目请求未通过校验" } };
  }
};
