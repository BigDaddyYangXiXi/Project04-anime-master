const assert = require("node:assert/strict");
const test = require("node:test");
const { runCleanupJob, runStatus, source } = require("./cleanup-run-core");

function db({ failInsert = false } = {}) {
  const runs = [];
  return { runs, from(table) {
    assert.equal(table, "media_cleanup_runs");
    return { insert(value) { runs.push(value); return Promise.resolve({ data: failInsert ? [] : [value], error: failInsert ? { message: "failed" } : null }); } };
  } };
}
function clock(...values) { let index = 0; return () => values[Math.min(index++, values.length - 1)]; }
const uuid = () => "11111111-2222-3333-4444-555555555555";
const pending = { scanned: 0, eligible: 0, deleted: 0, skipped: 0, failed: 0 };
const ready = { readyScanned: 0, quarantinedScanned: 0, quarantined: 0, restored: 0, deleted: 0, skipped: 0, failed: 0 };

test("classifies timer, manual and targeted runs", () => {
  assert.equal(source({ TriggerName: "hourly" }), "TIMER");
  assert.equal(source({}), "MANUAL");
  assert.equal(source({ assetId: "asset_1" }), "TARGET");
  assert.equal(runStatus(pending, ready), "SUCCESS");
  assert.equal(runStatus(pending, { ...ready, failed: 1 }), "PARTIAL");
});

test("persists a successful run summary", async () => {
  const database = db();
  const result = await runCleanupJob(database, {}, {}, { TriggerName: "hourly" }, clock(1000, 1100), uuid, {
    cleanupExpiredMedia: async () => pending,
    cleanupReadyOrphans: async () => ready
  });
  assert.deepEqual(result.audit, { runId: "mcr_11111111222233334444555555555555", source: "TIMER", status: "SUCCESS", saved: true });
  assert.equal(database.runs.length, 1);
  assert.equal(database.runs[0].pending_summary, JSON.stringify(pending));
  assert.equal(database.runs[0].ready_orphan_summary, JSON.stringify(ready));
});

test("cleanup result stays successful when only audit persistence fails", async () => {
  const result = await runCleanupJob(db({ failInsert: true }), {}, {}, {}, clock(1000, 1100), uuid, {
    cleanupExpiredMedia: async () => pending,
    cleanupReadyOrphans: async () => ready
  });
  assert.equal(result.audit.saved, false);
  assert.equal(result.audit.status, "SUCCESS");
});

test("records a failed cleanup and rejects user invocation before running", async () => {
  const database = db();
  await assert.rejects(() => runCleanupJob(database, {}, {}, {}, clock(1000, 1100), uuid, {
    cleanupExpiredMedia: async () => { const error = new Error("boom"); error.code = "CLEANUP_FAILED"; throw error; }
  }), (error) => error.code === "CLEANUP_FAILED");
  assert.equal(database.runs[0].status, "FAILED");
  assert.equal(database.runs[0].error_code, "CLEANUP_FAILED");
  await assert.rejects(() => runCleanupJob(db(), {}, { WX_OPENID: "user" }), (error) => error.code === "CALLER_NOT_ALLOWED");
});
