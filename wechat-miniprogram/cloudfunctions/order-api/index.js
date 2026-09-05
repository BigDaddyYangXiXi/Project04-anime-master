const { handleOrder } = require("./order-core");

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
    stage = "HANDLE_ORDER";
    const data = await handleOrder(db, event, caller, process.env.ORDER_CONTACT_ENCRYPTION_KEY, Date.now(), undefined, app);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "BUYER_ROLE_REQUIRED", "PROVIDER_ROLE_REQUIRED", "INVALID_ACTION", "VALIDATION_ERROR",
      "IDEMPOTENCY_CONFLICT", "PROVIDER_NOT_PUBLISHED", "SERVICE_NOT_PUBLISHED", "SERVICE_CITY_UNAVAILABLE", "WORK_NOT_PUBLISHED",
      "PROVIDER_NOT_AVAILABLE", "REFERENCE_MEDIA_NOT_READY", "INVALID_TIME_SEGMENTS",
      "SELF_ORDER_NOT_ALLOWED", "ORDER_NOT_FOUND", "VERSION_CONFLICT", "ILLEGAL_TRANSITION", "ORDER_ROLE_FORBIDDEN",
      "QUOTE_OUT_OF_RANGE", "QUOTE_ALREADY_LOCKED", "CONTACT_NOT_ACCESSED", "AGREEMENT_ALREADY_CONFIRMED", "PAYMENT_NOT_VERIFIED",
      "COOPERATION_CONFIRMATION_REQUIRED", "AGREEMENT_NOT_CONFIRMED",
      "PROGRESS_INVALID", "PROGRESS_UNCHANGED", "DELIVERY_FILES_REQUIRED", "DELIVERY_FILE_INVALID",
      "DELIVERY_ROUND_LIMIT", "DELIVERY_INCOMPLETE", "REVIEW_ALREADY_SUBMITTED", "REVIEW_RATING_INVALID",
      "REVIEW_NOT_FOUND", "REVIEW_REPLY_ALREADY_SUBMITTED"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "ORDER_API_FAILED";
    console.error(JSON.stringify({ scope: "order-api", code, stage, cause: error && error.code || "UNEXPECTED" }));
    return {
      ok: false,
      error: {
        code,
        message: code === "ORDER_API_FAILED" ? "订单服务暂不可用，请稍后重试"
          : code === "VERSION_CONFLICT" ? "订单状态已更新，请刷新后重试"
            : code === "PAYMENT_NOT_VERIFIED" ? "支付尚未由服务端确认"
              : "订单请求未通过校验"
      }
    };
  }
};
