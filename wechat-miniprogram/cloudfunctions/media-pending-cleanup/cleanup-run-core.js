const crypto = require("node:crypto");
const { cleanupExpiredMedia } = require("./cleanup-core");
const { cleanupReadyOrphans } = require("./ready-orphan-core");

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function rows(result, operation) { if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`); return result && result.data || []; }
function source(event) {
  if (event && event.assetId) return "TARGET";
  if (event && (event.TriggerName || event.Type === "Timer" || event.type === "timer")) return "TIMER";
  return "MANUAL";
}
function runStatus(pending, readyOrphans) {
  return Number(pending && pending.failed || 0) + Number(readyOrphans && readyOrphans.failed || 0) > 0 ? "PARTIAL" : "SUCCESS";
}
async function saveRun(db, value) {
  rows(await db.from("media_cleanup_runs").insert({
    ...value,
    pending_summary: value.pending_summary == null ? null : JSON.stringify(value.pending_summary),
    ready_orphan_summary: value.ready_orphan_summary == null ? null : JSON.stringify(value.ready_orphan_summary)
  }), "save media cleanup run");
}
async function runCleanupJob(db, storage, context = {}, event = {}, clock = Date.now, uuid = crypto.randomUUID, operations = {}) {
  if (context.WX_OPENID || context.OPENID) fail("CALLER_NOT_ALLOWED", "cleanup only accepts system invocation");
  const pendingCleanup = operations.cleanupExpiredMedia || cleanupExpiredMedia;
  const readyCleanup = operations.cleanupReadyOrphans || cleanupReadyOrphans;
  const startedAt = clock();
  const runId = `mcr_${uuid().replace(/-/g, "")}`;
  const runSource = source(event);
  let pending = null;
  let readyOrphans = null;
  try {
    pending = await pendingCleanup(db, storage, context, startedAt, undefined, event.assetId);
    readyOrphans = event.assetId ? null : await readyCleanup(db, storage, context, startedAt);
    const status = runStatus(pending, readyOrphans);
    const finishedAt = clock();
    let saved = true;
    try {
      await saveRun(db, { id: runId, source: runSource, status, pending_summary: pending, ready_orphan_summary: readyOrphans, error_code: null, started_at: startedAt, finished_at: finishedAt });
    } catch (error) {
      saved = false;
      console.error(JSON.stringify({ scope: "media-cleanup-run-audit", code: error && error.code || "UNEXPECTED" }));
    }
    return { pending, readyOrphans, audit: { runId, source: runSource, status, saved } };
  } catch (error) {
    const finishedAt = clock();
    await saveRun(db, { id: runId, source: runSource, status: "FAILED", pending_summary: pending, ready_orphan_summary: readyOrphans, error_code: String(error && error.code || "UNEXPECTED").slice(0, 64), started_at: startedAt, finished_at: finishedAt }).catch(() => null);
    throw error;
  }
}

module.exports = { runCleanupJob, runStatus, source };
