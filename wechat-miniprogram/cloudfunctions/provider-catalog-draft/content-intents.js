// Packaged identically with account-api and provider-catalog-draft.
const crypto = require("node:crypto");
function fail(code) { throw Object.assign(new Error(code), { code }); }
function rows(result) { if (result?.error) fail("CONTENT_INTENT_UNAVAILABLE"); return result?.data || []; }
function enabled() { return process.env.CONTENT_INTENTS_ENABLED === "true"; }
async function stage(db, owner, kind, version, payload, now = Date.now()) {
  if (!enabled()) fail("CONTENT_INTENT_UNAVAILABLE");
  const id = crypto.randomBytes(16).toString("hex");
  rows(await db.from("content_intents").insert({
    id, account_id: owner, kind, expected_version: version, payload: JSON.stringify(payload),
    status: "STAGED", result_code: "", created_at: now, updated_at: now
  }));
  return id;
}
async function activate(db, id, now = Date.now()) {
  // A lost activation is recoverable: the worker also checks linked STAGED records.
  rows(await db.from("content_intents").update({ status: "PENDING", updated_at: now }).eq("id", id).eq("status", "STAGED"));
}
async function status(db, owner, id) {
  if (!id || !enabled()) return null;
  const row = rows(await db.from("content_intents").select("id,kind,status,result_code,expected_version,payload")
    .eq("id", id).eq("account_id", owner))[0];
  const payload = row ? (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) : null;
  return row ? { ...(row.kind === "AVATAR" ? { assetId: payload?.assets?.[0]?.id } : {}), id: row.id, kind: row.kind, status: row.status, code: row.result_code, expectedVersion: Number(row.expected_version) } : null;
}
module.exports = { enabled, stage, activate, status };

async function wake(app, intentId) {
  if (!enabled() || !process.env.CONTENT_INTENT_WORKER_TOKEN) return;
  try { await app.callFunction({ name: "content-intent-worker", data: { workerToken: process.env.CONTENT_INTENT_WORKER_TOKEN, intentId } }); }
  catch (_) { console.error("content-intent-worker wake failed; scheduled retry required"); }
}
module.exports.wake = wake;
