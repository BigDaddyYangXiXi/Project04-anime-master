const { handleAvailability } = require("./availability-core");

exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = cloudbase.getCloudbaseContext(context);
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    return { ok: true, data: await handleAvailability(app.rdb(), event, caller) };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "PROVIDER_ROLE_REQUIRED", "INVALID_ACTION",
      "VALIDATION_ERROR", "VERSION_CONFLICT", "LOCKED_DATE_MUTATION"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "AVAILABILITY_API_FAILED";
    console.error(JSON.stringify({ scope: "availability-api", code, cause: error && error.code || "UNEXPECTED" }));
    return { ok: false, error: { code, message: code === "AVAILABILITY_API_FAILED" ? "档期服务暂不可用，请稍后重试" : "档期请求未通过校验" } };
  }
};
