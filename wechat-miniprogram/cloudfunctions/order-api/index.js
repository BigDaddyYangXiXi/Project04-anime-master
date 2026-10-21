const { handleOrder } = require("./order-core");

exports.main = async (event, context) => {
  let stage = "LOAD_SDK";
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    stage = "READ_CALLER";
    const caller = require('./request-context')(context);
    if (!(caller.WX_OPENID || caller.OPENID) || (caller.WX_APPID || caller.APPID) !== 'wxc94e1c1b38944511') {
      const error = new Error('AUTH_CONTEXT_MISSING'); error.code = error.message; throw error;
    }
    stage = "INIT_SDK";
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    stage = "INIT_RDB";
    const db = app.rdb();
    stage = "HANDLE_ORDER";
    const persistConfirmation = (row, next) => process.env.ORDER_SLOT_RELAY_ENABLED === 'true'
      ? require('./slot-relay').persist(row, next) : require("./slot-runtime")(row, next);
    const data = await handleOrder(db, event, caller, process.env.ORDER_CONTACT_ENCRYPTION_KEY, Date.now(), undefined, app, persistConfirmation);
    if (process.env.ORDER_NOTIFICATION_ENABLED === 'true' && ['createOrder', 'transitionOrder'].includes(event.action)) {
      try {
        const result = await require('./notification-trigger').triggerNotification(event.action, data, event.event,
          process.env.NOTIFICATION_RELAY_KEY, signed => {
            const notificationApp = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV, timeout: 2000, retries: 0 });
            return notificationApp.callFunction({ name: 'order-notification-public', data: signed });
          });
        console.log(JSON.stringify({ scope: 'order-notification-trigger', status: result.status, recorded: result.recorded === true }));
      } catch (_) {
        console.error(JSON.stringify({ scope: 'order-notification-trigger', code: 'NOTIFICATION_TRIGGER_UNCONFIRMED' }));
      }
    }
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set([
      "AUTH_CONTEXT_MISSING", "ACCOUNT_NOT_FOUND", "BUYER_ROLE_REQUIRED", "PROVIDER_ROLE_REQUIRED", "INVALID_ACTION", "VALIDATION_ERROR",
      "IDEMPOTENCY_CONFLICT", "PROVIDER_NOT_PUBLISHED", "SERVICE_NOT_PUBLISHED", "SERVICE_CITY_UNAVAILABLE", "WORK_NOT_PUBLISHED",
      "PROVIDER_NOT_AVAILABLE", "PROVIDER_NOT_QUALIFIED", "REFERENCE_MEDIA_NOT_READY", "INVALID_TIME_SEGMENTS",
      "SELF_ORDER_NOT_ALLOWED", "ORDER_NOT_FOUND", "VERSION_CONFLICT", "ILLEGAL_TRANSITION", "ORDER_ROLE_FORBIDDEN",
      "QUOTE_OUT_OF_RANGE", "QUOTE_ALREADY_LOCKED", "CONTACT_NOT_ACCESSED", "AGREEMENT_ALREADY_CONFIRMED", "PAYMENT_NOT_VERIFIED",
      "COOPERATION_CONFIRMATION_REQUIRED", "AGREEMENT_NOT_CONFIRMED", "SCHEDULE_CONFLICT", "SLOT_STORE_NOT_CONFIGURED", "NDA_REQUIRED",
      "PROGRESS_INVALID", "PROGRESS_UNCHANGED", "DELIVERY_FILES_REQUIRED", "DELIVERY_FILE_INVALID",
      "DELIVERY_ROUND_LIMIT", "DELIVERY_INCOMPLETE", "REVIEW_ALREADY_SUBMITTED", "REVIEW_RATING_INVALID",
      "REVIEW_NOT_FOUND", "REVIEW_REPLY_ALREADY_SUBMITTED", "ORDER_FUNDS_HELD"
    ]);
    const code = publicCodes.has(error && error.code) ? error.code : "ORDER_API_FAILED";
    console.error(JSON.stringify({ scope: "order-api", code, stage, cause: publicCodes.has(code) ? code : "UNEXPECTED" }));
    return {
      ok: false,
      error: {
        code,
        message: code === "ORDER_API_FAILED" ? "订单服务暂不可用，请稍后重试"
          : code === "SCHEDULE_CONFLICT" ? "该时段已有已确认的合作，请调整时间后重新预约"
          : code === "SLOT_STORE_NOT_CONFIGURED" ? "档期确认服务暂不可用，请稍后重试"
          : code === "VERSION_CONFLICT" ? "订单状态已更新，请刷新后重试"
            : code === "PAYMENT_NOT_VERIFIED" ? "支付尚未由服务端确认"
              : "订单请求未通过校验"
      }
    };
  }
};
