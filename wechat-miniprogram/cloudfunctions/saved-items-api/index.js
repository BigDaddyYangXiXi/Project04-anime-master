const { handleSavedItems } = require("./saved-items-core");
exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = cloudbase.getCloudbaseContext(context);
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    return { ok: true, data: await handleSavedItems(app.rdb(), event, caller) };
  } catch (error) {
    const publicCodes = new Set(["AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "INVALID_ACTION", "VALIDATION_ERROR", "TARGET_NOT_PUBLIC"]);
    const code = publicCodes.has(error && error.code) ? error.code : "SAVED_ITEMS_API_FAILED";
    console.error(JSON.stringify({ scope: "saved-items-api", code, cause: error && error.code || "UNEXPECTED" }));
    return { ok: false, error: { code, message: code === "SAVED_ITEMS_API_FAILED" ? "收藏服务暂不可用，请稍后重试" : "收藏请求未通过校验" } };
  }
};
