const { handleMediaUpload } = require("./media-core");
const COMPANY_ENV = "cloudbase-d2g65rqbvee0bd978";

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
    const app = cloudbase.init({ env: COMPANY_ENV });
    stage = "INIT_RDB";
    const db = app.rdb();
    stage = "HANDLE_MEDIA";
    const data = await handleMediaUpload(db, app, event, { ...caller, TCB_ENV: COMPANY_ENV });
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "INVALID_ACTION", "VALIDATION_ERROR",
      "UNSUPPORTED_MEDIA_TYPE", "MEDIA_SIZE_INVALID", "MEDIA_NOT_FOUND", "MEDIA_STATE_INVALID",
      "FILE_ID_MISMATCH", "MEDIA_FILE_MISSING", "MEDIA_FILE_REJECTED", "MEDIA_STATE_CONFLICT",
      "MEDIA_DELETE_FAILED", "DELIVERY_ORDER_NOT_FOUND", "DELIVERY_ORDER_STATE_INVALID"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "MEDIA_UPLOAD_FAILED";
    const reason = code === "MEDIA_DELETE_FAILED" && new Set([
      "METADATA_REJECTED", "MISSING_RECEIPT", "RECEIPT_FILE_MISMATCH", "STORAGE_NONEXIST", "STORAGE_REJECTED"
    ]).has(error.reason) ? error.reason : undefined;
    console.error(JSON.stringify({
      scope: "media-upload",
      code,
      stage,
      reason,
      cause: publicCodes.has(code) ? code : "UNEXPECTED"
    }));
    return {
      ok: false,
      error: {
        code,
        ...(reason ? { reason } : {}),
        message: code === "MEDIA_UPLOAD_FAILED" ? "媒体处理失败，请稍后重试" : "媒体请求未通过校验"
      }
    };
  }
};
