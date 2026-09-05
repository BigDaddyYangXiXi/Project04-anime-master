const { handleProviderDraft } = require("./draft-core");
const { handleProviderPublish } = require("./publication-core");

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
    stage = event && event.action === "publishDraft" ? "PUBLISH_DRAFT" : "HANDLE_DRAFT";
    const data = stage === "PUBLISH_DRAFT"
      ? await handleProviderPublish(db, event, caller)
      : await handleProviderDraft(db, event, caller);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING",
      "ACCOUNT_NOT_FOUND",
      "PROVIDER_ROLE_REQUIRED",
      "INVALID_ACTION",
      "VALIDATION_ERROR",
      "VERSION_CONFLICT",
      "DRAFT_NOT_FOUND",
      "PUBLISH_VALIDATION_FAILED",
      "MEDIA_NOT_READY",
      "PUBLISH_CONFLICT"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "PROVIDER_DRAFT_FAILED";
    console.error(JSON.stringify({
      scope: "provider-catalog-draft",
      code,
      stage,
      cause: error && error.code ? error.code : "UNEXPECTED"
    }));
    return {
      ok: false,
      error: {
        code,
        ...(code === "PUBLISH_VALIDATION_FAILED" && error.details ? { details: error.details } : {}),
        message: code === "VERSION_CONFLICT"
          ? "草稿已在其他页面更新，请刷新后重试"
          : code === "PROVIDER_DRAFT_FAILED"
            ? "商家资料草稿保存失败，请稍后重试"
            : code === "PUBLISH_VALIDATION_FAILED"
              ? "橱窗资料不完整，请补充后再发布"
              : code === "MEDIA_NOT_READY"
                ? "作品图片仍在安全审核中，请稍后再发布"
            : "请求未通过校验"
      }
    };
  }
};
