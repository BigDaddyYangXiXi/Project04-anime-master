const { cleanupErrorCode } = require("./cleanup-core");

const READY_ORPHAN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ORPHAN_QUARANTINE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_READY_BATCH_SIZE = 50;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function rows(result, operation) { if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`); return result && result.data || []; }
function collectAssetIds(value, output) {
  if (typeof value === "string") {
    if (/^asset_[a-f0-9]{32}$/.test(value)) output.add(value);
    return;
  }
  if (Array.isArray(value)) { value.forEach((item) => collectAssetIds(item, output)); return; }
  if (value && typeof value === "object") Object.values(value).forEach((item) => collectAssetIds(item, output));
}
function collectPayload(row, output) {
  if (!row || row.payload == null) return;
  let payload = row.payload;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { fail("MEDIA_REFERENCE_INVALID", "media reference payload is invalid"); }
  }
  collectAssetIds(payload, output);
}
async function ownerReferenceIds(db, ownerId) {
  const output = new Set();
  const account = rows(await db.from("accounts").select("avatar_asset_id").eq("id", ownerId), "read avatar reference")[0];
  if (account && account.avatar_asset_id) output.add(account.avatar_asset_id);
  const profile = rows(await db.from("provider_profiles").select("notice_image_asset_id").eq("provider_id", ownerId), "read notice reference")[0];
  if (profile && profile.notice_image_asset_id) output.add(profile.notice_image_asset_id);
  const draft = rows(await db.from("provider_catalog_drafts").select("payload").eq("provider_id", ownerId), "read draft references")[0];
  const publication = rows(await db.from("provider_catalog_publications").select("payload").eq("provider_id", ownerId), "read publication references")[0];
  collectPayload(draft, output); collectPayload(publication, output);
  rows(await db.from("content_intents").select("payload").eq("account_id", ownerId).in("status", ["STAGED", "PENDING"]), "read pending content references").forEach(row => collectPayload(row, output));
  rows(await db.from("project_aggregates").select("payload").eq("buyer_id", ownerId), "read project references").forEach((row) => collectPayload(row, output));
  rows(await db.from("support_requests").select("payload").eq("account_id", ownerId), "read support references").forEach((row) => collectPayload(row, output));
  rows(await db.from("order_aggregates").select("payload").eq("buyer_id", ownerId), "read buyer order references").forEach((row) => collectPayload(row, output));
  rows(await db.from("order_aggregates").select("payload").eq("provider_id", ownerId), "read provider order references").forEach((row) => collectPayload(row, output));
  const works = rows(await db.from("works").select("id").eq("provider_id", ownerId), "read owned works");
  if (works.length) {
    rows(await db.from("work_images").select("asset_id").in("work_id", works.map((work) => work.id)), "read normalized work references")
      .forEach((row) => output.add(row.asset_id));
  }
  return output;
}
async function updateState(db, asset, fromStatus, value, operation) {
  return rows(await db.from("media_assets").update(value).eq("id", asset.id).eq("status", fromStatus).select("id"), operation).length > 0;
}
async function cleanupReadyOrphans(db, storage, context = {}, now = Date.now(), batchSize = DEFAULT_READY_BATCH_SIZE) {
  if (context.WX_OPENID || context.OPENID) fail("CALLER_NOT_ALLOWED", "cleanup only accepts system invocation");
  if (!Number.isSafeInteger(now) || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > DEFAULT_READY_BATCH_SIZE) fail("CLEANUP_CONFIG_INVALID", "cleanup configuration is invalid");
  const ready = rows(await db.from("media_assets").select("id,owner_account_id,storage_key,status,committed_at,orphaned_at")
    .eq("status", "READY").lt("committed_at", now - READY_ORPHAN_TTL_MS).limit(batchSize), "read ready orphan candidates");
  const quarantined = rows(await db.from("media_assets").select("id,owner_account_id,storage_key,status,committed_at,orphaned_at")
    .eq("status", "ORPHAN_CANDIDATE").lt("orphaned_at", now - ORPHAN_QUARANTINE_MS).limit(batchSize), "read quarantined orphan candidates");
  const summary = { readyScanned: ready.length, quarantinedScanned: quarantined.length, quarantined: 0, restored: 0, deleted: 0, skipped: 0, failed: 0, deferred: 0 };
  const referencesByOwner = new Map();
  async function references(asset) {
    if (!referencesByOwner.has(asset.owner_account_id)) referencesByOwner.set(asset.owner_account_id, await ownerReferenceIds(db, asset.owner_account_id));
    return referencesByOwner.get(asset.owner_account_id);
  }
  for (const asset of quarantined) {
    try {
      if ((await references(asset)).has(asset.id)) {
        if (await updateState(db, asset, "ORPHAN_CANDIDATE", { status: "READY", orphaned_at: null }, "restore referenced media")) summary.restored += 1;
        else summary.skipped += 1;
        continue;
      }
      // Absence in a reference scan is not a deletion lock: writers may still
      // publish a reference, and database result limits may truncate the scan.
      // Resume reclamation only with complete reads and atomic reference guards.
      summary.deferred += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(JSON.stringify({ scope: "media-ready-orphan-cleanup", code: cleanupErrorCode(error) }));
    }
  }
  for (const asset of ready) {
    try {
      if ((await references(asset)).has(asset.id)) { summary.skipped += 1; continue; }
      // Quarantining also invalidates media for writers that require READY.
      summary.deferred += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(JSON.stringify({ scope: "media-ready-orphan-cleanup", code: cleanupErrorCode(error) }));
    }
  }
  return summary;
}

module.exports = { DEFAULT_READY_BATCH_SIZE, ORPHAN_QUARANTINE_MS, READY_ORPHAN_TTL_MS, cleanupReadyOrphans, collectAssetIds, ownerReferenceIds };
