const { runCleanupJob } = require("./cleanup-run-core");

exports.main = async (event, context) => {
  try {
    const cloudbase = require("@cloudbase/node-sdk");
    const caller = cloudbase.getCloudbaseContext(context);
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    const db = app.rdb();
    const data = await runCleanupJob(db, app, caller, event || {});
    return { ok: true, data };
  } catch (error) {
    const publicCodes = new Set(["CALLER_NOT_ALLOWED", "CLEANUP_CONFIG_INVALID"]);
    const code = publicCodes.has(error && error.code) ? error.code : "MEDIA_CLEANUP_FAILED";
    console.error(JSON.stringify({ scope: "media-pending-cleanup", code }));
    return { ok: false, error: { code, message: "媒体过期清理未完成" } };
  }
};
