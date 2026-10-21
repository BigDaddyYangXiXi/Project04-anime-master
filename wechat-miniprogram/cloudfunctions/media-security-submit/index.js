const { handleMediaSecurity } = require("./media-security-core");
const { createWxOpenApiAdapter } = require("./wx-openapi-adapter");

exports.main = async (event, context) => {
  let stage = "LOAD_SDK";
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    stage = "READ_CALLER";
    const caller = require('./request-context')(context);
    const openId = caller.WX_OPENID || caller.OPENID;
    if ((caller.WX_APPID || caller.APPID) !== "wxc94e1c1b38944511" || typeof openId !== "string" || !openId.trim()) {
      const error = new Error("trusted company identity required"); error.code = "AUTH_CONTEXT_MISSING"; throw error;
    }
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    let wxApi = {};
    if (event && event.action === "submitImage") {
      const wxCloud = require("wx-server-sdk");
      wxCloud.init({ env: wxCloud.DYNAMIC_CURRENT_ENV });
      wxApi = createWxOpenApiAdapter(wxCloud);
    }
    stage = "SUBMIT_MEDIA_CHECK";
    const data = await handleMediaSecurity(app.rdb(), app, wxApi, event, caller);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "INVALID_ACTION", "VALIDATION_ERROR",
      "MEDIA_NOT_FOUND", "MEDIA_STATE_INVALID", "MEDIA_NOT_COMMITTED", "MEDIA_URL_UNAVAILABLE",
      "WECHAT_MEDIA_CHECK_FAILED", "MEDIA_STATE_CONFLICT", "UNSUPPORTED_MEDIA_TYPE"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "MEDIA_SECURITY_SUBMIT_FAILED";
    console.error(JSON.stringify({
      scope: "media-security-submit",
      code,
      stage,
      cause: publicCodes.has(code) ? code : "UNEXPECTED"
    }));
    return {
      ok: false,
      error: {
        code,
        message: code === "MEDIA_SECURITY_SUBMIT_FAILED" ? "媒体安全审核提交失败，请稍后重试" : "媒体安全审核请求未通过"
      }
    };
  }
};
