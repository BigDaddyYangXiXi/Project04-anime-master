const { handleMediaSecurity } = require("./media-security-core");
const { createWxOpenApiAdapter } = require("./wx-openapi-adapter");

exports.main = async (event, context) => {
  let stage = "LOAD_SDK";
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const wxCloud = require("wx-server-sdk");
    stage = "READ_CALLER";
    const caller = cloudbase.getCloudbaseContext(context);
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    wxCloud.init({ env: wxCloud.DYNAMIC_CURRENT_ENV });
    stage = "SUBMIT_MEDIA_CHECK";
    const data = await handleMediaSecurity(app.rdb(), app, createWxOpenApiAdapter(wxCloud), event, caller);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "INVALID_ACTION", "VALIDATION_ERROR",
      "MEDIA_NOT_FOUND", "MEDIA_STATE_INVALID", "MEDIA_NOT_COMMITTED", "MEDIA_URL_UNAVAILABLE",
      "WECHAT_MEDIA_CHECK_FAILED"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "MEDIA_SECURITY_SUBMIT_FAILED";
    console.error(JSON.stringify({
      scope: "media-security-submit",
      code,
      stage,
      cause: error && error.code ? error.code : "UNEXPECTED"
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
