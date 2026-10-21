const { handleProviderDraft } = require("./draft-core");
const { handleProviderPublish } = require("./publication-core");
const { handleQualification } = require("./qualification-core");

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
    stage = "INIT_RDB";
    const db = app.rdb();
    stage = event && ["publishDraft", "getPublishIntent", "cancelPublishIntent"].includes(event.action) ? "PUBLISH_DRAFT" : "HANDLE_DRAFT";
    const data = event && ["getQualification", "submitQualification"].includes(event.action)
      ? await handleQualification(db, event, caller)
      : stage === "PUBLISH_DRAFT"
      ? await handleProviderPublish(db, event, caller, Date.now(), {
        mutatePublication: async mutation => {
          const result = await app.callFunction({ name: 'content-intent-worker', data: { workerToken: process.env.CONTENT_INTENT_WORKER_TOKEN, mutation } });
          if (!result.result || result.result.error) throw Object.assign(new Error('CONTENT_INTENT_UNAVAILABLE'), { code: 'CONTENT_INTENT_UNAVAILABLE' });
          return result.result;
        }
      })
      : await handleProviderDraft(db, event, caller);
    if (data?.queued) await require("./content-intents").wake(app, data.intentId);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING",
      "ACCOUNT_NOT_FOUND",
      "PROVIDER_ROLE_REQUIRED",
      "PROVIDER_NOT_AVAILABLE",
      "INVALID_ACTION",
      "VALIDATION_ERROR",
      "VERSION_CONFLICT",
      "DRAFT_NOT_FOUND",
      "PUBLISH_VALIDATION_FAILED",
      "MEDIA_NOT_READY",
      "SERVICE_NAME_REJECTED",
      "SERVICE_NAME_CHECK_UNAVAILABLE",
      "PUBLISH_CONFLICT", "CLIENT_UPGRADE_REQUIRED", "CONTENT_INTENT_UNAVAILABLE", "IDEMPOTENCY_CONFLICT"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "PROVIDER_DRAFT_FAILED";
    console.error(JSON.stringify({
      scope: "provider-catalog-draft",
      code,
      stage,
      cause: publicCodes.has(code) ? code : "UNEXPECTED"
    }));
    return {
      ok: false,
      error: {
        code,
        ...(code === "PUBLISH_VALIDATION_FAILED" && error.details ? { details: error.details } : {}),
        message: code === "SERVICE_NAME_REJECTED" ? "服务名称含不适宜内容或未通过审核，请修改后再保存"
          : code === "SERVICE_NAME_CHECK_UNAVAILABLE" ? "服务名称审核暂不可用，修改已保留，请稍后重试"
          : code === "VERSION_CONFLICT"
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
