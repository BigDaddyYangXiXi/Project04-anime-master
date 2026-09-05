const { handleMediaUpload } = require("./media-core");

exports.main = async (event, context) => {
  let stage = "LOAD_SDK";
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    stage = "READ_CALLER";
    const caller = cloudbase.getCloudbaseContext(context);
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    stage = "INIT_RDB";
    const db = app.rdb();
    stage = "HANDLE_MEDIA";
    const data = await handleMediaUpload(db, app, event, caller);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "INVALID_ACTION", "VALIDATION_ERROR",
      "UNSUPPORTED_MEDIA_TYPE", "MEDIA_SIZE_INVALID", "MEDIA_NOT_FOUND", "MEDIA_STATE_INVALID",
      "FILE_ID_MISMATCH", "MEDIA_FILE_MISSING", "MEDIA_FILE_REJECTED", "MEDIA_STATE_CONFLICT",
      "MEDIA_DELETE_FAILED", "DELIVERY_ORDER_NOT_FOUND", "DELIVERY_ORDER_STATE_INVALID"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "MEDIA_UPLOAD_FAILED";
    console.error(JSON.stringify({
      scope: "media-upload",
      code,
      stage,
      cause: error && error.code ? error.code : "UNEXPECTED"
    }));
    return {
      ok: false,
      error: {
        code,
        message: code === "MEDIA_UPLOAD_FAILED" ? "媒体处理失败，请稍后重试" : "媒体请求未通过校验"
      }
    };
  }
};
