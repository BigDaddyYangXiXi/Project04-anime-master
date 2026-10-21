const { runCleanupJob } = require("./cleanup-run-core");
const crypto = require("node:crypto");

function authorize(context, event) {
  const token = process.env.MEDIA_CLEANUP_TOKEN;
  if (process.env.SCF_NAMESPACE !== "cloudbase-d2g65rqbvee0bd978" || !/^[a-f0-9]{64}$/.test(token || "")) {
    throw Object.assign(new Error("CLEANUP_CONFIG_INVALID"), { code: "CLEANUP_CONFIG_INVALID" });
  }
  const supplied = event && event.cleanupToken;
  if (context.WX_OPENID || context.OPENID || typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied)
    || !crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(supplied, "hex"))) {
    throw Object.assign(new Error("CALLER_NOT_ALLOWED"), { code: "CALLER_NOT_ALLOWED" });
  }
}

exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = require('./request-context')(context);
    authorize(caller || {}, event);
    const { cleanupToken, ...request } = event;
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const db = app.rdb();
    const data = await runCleanupJob(db, app, caller, request);
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set(["CALLER_NOT_ALLOWED", "CLEANUP_CONFIG_INVALID"]);
    const code = publicCodes.has(error && error.code) ? error.code : "MEDIA_CLEANUP_FAILED";
    console.error(JSON.stringify({ scope: "media-pending-cleanup", code }));
    return { ok: false, error: { code, message: "媒体过期清理未完成" } };
  }
};
