const UNCOMMITTED_TTL_MS = 2 * 60 * 60 * 1000;
const COMMITTED_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 100;
const LOG_CODES = new Set([
  "DATABASE_OPERATION_FAILED", "MEDIA_STORAGE_KEY_INVALID", "MEDIA_FILE_ID_UNAVAILABLE",
  "MEDIA_DELETE_FAILED", "CALLER_NOT_ALLOWED", "CLEANUP_CONFIG_INVALID", "MEDIA_REFERENCE_INVALID"
]);

function cleanupErrorCode(error) {
  return LOG_CODES.has(error && error.code) ? error.code : "UNEXPECTED";
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function rows(result, operation) {
  if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`);
  return (result && result.data) || [];
}

function isExpired(asset, now) {
  if (asset && asset.status === "REJECTED") {
    return Number.isSafeInteger(Number(asset.deleted_at)) && Number(asset.deleted_at) > 0 && Number(asset.deleted_at) <= now - UNCOMMITTED_TTL_MS;
  }
  if (!asset || asset.status !== "PENDING") return false;
  const timestamp = Number(asset.committed_at || asset.created_at);
  const ttl = asset.committed_at ? COMMITTED_TTL_MS : UNCOMMITTED_TTL_MS;
  return Number.isSafeInteger(timestamp) && timestamp <= now - ttl;
}

function uploadPath(value) {
  return typeof value === "string" && /^user-uploads\/[A-Za-z0-9_./-]+$/.test(value)
    && value.split("/").every(part => part && part !== "." && part !== "..");
}

function filePath(fileId, code) {
  const parts = typeof fileId === "string"
    && /^cloud:\/\/cloudbase-d2g65rqbvee0bd978\.[A-Za-z0-9_-]+\/(.+)$/.exec(fileId);
  if (!parts || !uploadPath(parts[1])) fail(code, "storage file id is outside the company upload root");
  return parts[1];
}

async function resolveFileId(storage, storageKey) {
  if (typeof storageKey !== "string" || !storageKey) fail("MEDIA_STORAGE_KEY_INVALID", "storage key is invalid");
  if (storageKey.startsWith("cloud://")) {
    filePath(storageKey, "MEDIA_STORAGE_KEY_INVALID");
    return storageKey;
  }
  if (!uploadPath(storageKey)) fail("MEDIA_STORAGE_KEY_INVALID", "storage key is outside the upload root");
  const metadata = await storage.getUploadMetadata({ cloudPath: storageKey });
  const fileId = metadata && !metadata.code && metadata.data && metadata.data.fileId;
  if (typeof fileId !== "string" || !fileId.startsWith("cloud://")) {
    fail("MEDIA_FILE_ID_UNAVAILABLE", "storage file id is unavailable");
  }
  if (filePath(fileId, "MEDIA_FILE_ID_UNAVAILABLE") !== storageKey) {
    fail("MEDIA_FILE_ID_UNAVAILABLE", "storage file id does not match the company upload path");
  }
  return fileId;
}

async function deleteFile(storage, storageKey) {
  const fileId = await resolveFileId(storage, storageKey);
  const result = await storage.deleteFile({ fileList: [fileId] });
  const item = result && result.fileList && result.fileList[0];
  if (!item || item.code !== "SUCCESS" || item.fileID !== fileId) {
    fail("MEDIA_DELETE_FAILED", "expired media file could not be deleted");
  }
}

async function readAsset(db, id) {
  return rows(
    await db.from("media_assets").select("id,status").eq("id", id),
    "read media cleanup state"
  )[0] || null;
}

async function cleanupExpiredMedia(db, storage, context = {}, now = Date.now(), batchSize = DEFAULT_BATCH_SIZE, targetAssetId = "") {
  if (context.WX_OPENID || context.OPENID) fail("CALLER_NOT_ALLOWED", "cleanup only accepts system invocation");
  if (!Number.isSafeInteger(now) || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > DEFAULT_BATCH_SIZE) {
    fail("CLEANUP_CONFIG_INVALID", "cleanup configuration is invalid");
  }
  if (targetAssetId && !/^asset_[a-f0-9]{32}$/.test(targetAssetId)) {
    fail("CLEANUP_CONFIG_INVALID", "target asset id is invalid");
  }

  let query = db.from("media_assets")
    .select("id,storage_key,status,created_at,committed_at,deleted_at")
    .eq("status", "PENDING")
    .is("committed_at", null)
    .lt("created_at", now - UNCOMMITTED_TTL_MS);
  if (targetAssetId) query = query.eq("id", targetAssetId);
  const pending = rows(
    await query.limit(targetAssetId ? 1 : batchSize),
    "read expired media candidates"
  );
  // Apply each expiry window before LIMIT so recent review submissions do not
  // occupy the batch intended for expired uploads.
  let committedQuery = db.from("media_assets")
    .select("id,storage_key,status,created_at,committed_at,deleted_at")
    .eq("status", "PENDING").lt("committed_at", now - COMMITTED_TTL_MS);
  if (targetAssetId) committedQuery = committedQuery.eq("id", targetAssetId);
  const committed = rows(await committedQuery.limit(targetAssetId ? 1 : batchSize), "read expired committed media");
  // REJECTED with a deletion timestamp is an invalid upload or a claimed
  // cancellation/cleanup. Moderation rejections without that marker stay intact.
  let retries = db.from("media_assets").select("id,storage_key,status,created_at,committed_at,deleted_at")
    .eq("status", "REJECTED").gt("deleted_at", 0).lt("deleted_at", now - UNCOMMITTED_TTL_MS);
  if (targetAssetId) retries = retries.eq("id", targetAssetId);
  const candidates = pending.concat(committed, rows(await retries.limit(targetAssetId ? 1 : batchSize), "read deletion retries"));
  const expired = candidates.filter((asset) => isExpired(asset, now));
  const summary = { scanned: candidates.length, eligible: expired.length, deleted: 0, skipped: 0, failed: 0 };

  for (const asset of expired) {
    try {
      let claim = db.from("media_assets").update({ status: "REJECTED", deleted_at: now })
        .eq("id", asset.id).eq("status", asset.status).eq("storage_key", asset.storage_key);
      claim = asset.committed_at == null ? claim.is("committed_at", null) : claim.eq("committed_at", asset.committed_at);
      if (!rows(await claim.select("id"), "claim expired media").length) { summary.skipped += 1; continue; }
      await deleteFile(storage, asset.storage_key);
      const updated = rows(
        await db.from("media_assets")
          .update({ status: "DELETED", deleted_at: now })
          .eq("id", asset.id)
          .eq("status", "REJECTED")
          .select("id"),
        "mark expired media deleted"
      );
      if (updated.length) summary.deleted += 1;
      else summary.skipped += 1;
    } catch (error) {
      const current = await readAsset(db, asset.id).catch(() => null);
      if (current && current.status === "DELETED") summary.skipped += 1;
      else summary.failed += 1;
      console.error(JSON.stringify({ scope: "media-pending-cleanup", code: cleanupErrorCode(error) }));
    }
  }
  return summary;
}

module.exports = {
  COMMITTED_TTL_MS,
  DEFAULT_BATCH_SIZE,
  UNCOMMITTED_TTL_MS,
  cleanupExpiredMedia,
  cleanupErrorCode,
  deleteFile,
  isExpired
};
