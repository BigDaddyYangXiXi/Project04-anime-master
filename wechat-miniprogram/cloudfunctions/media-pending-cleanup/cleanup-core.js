const UNCOMMITTED_TTL_MS = 2 * 60 * 60 * 1000;
const COMMITTED_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 100;

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
  if (!asset || asset.status !== "PENDING") return false;
  const timestamp = Number(asset.committed_at || asset.created_at);
  const ttl = asset.committed_at ? COMMITTED_TTL_MS : UNCOMMITTED_TTL_MS;
  return Number.isSafeInteger(timestamp) && timestamp <= now - ttl;
}

async function resolveFileId(storage, storageKey) {
  if (typeof storageKey !== "string" || !storageKey) fail("MEDIA_STORAGE_KEY_INVALID", "storage key is invalid");
  if (storageKey.startsWith("cloud://")) return storageKey;
  if (!storageKey.startsWith("user-uploads/")) fail("MEDIA_STORAGE_KEY_INVALID", "storage key is outside the upload root");
  const metadata = await storage.getUploadMetadata({ cloudPath: storageKey });
  const fileId = metadata && (metadata.fileId || metadata.fileID);
  if (typeof fileId !== "string" || !fileId.startsWith("cloud://")) {
    fail("MEDIA_FILE_ID_UNAVAILABLE", "storage file id is unavailable");
  }
  return fileId;
}

async function deleteFile(storage, storageKey) {
  const fileId = await resolveFileId(storage, storageKey);
  const result = await storage.deleteFile({ fileList: [fileId] });
  const item = result && result.fileList && result.fileList[0];
  if (!item || (item.code && item.code !== "SUCCESS")) {
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
    .select("id,storage_key,status,created_at,committed_at")
    .eq("status", "PENDING")
    .lt("created_at", now - UNCOMMITTED_TTL_MS);
  if (targetAssetId) query = query.eq("id", targetAssetId);
  const candidates = rows(
    await query.limit(targetAssetId ? 1 : batchSize),
    "read expired media candidates"
  );
  const expired = candidates.filter((asset) => isExpired(asset, now));
  const summary = { scanned: candidates.length, eligible: expired.length, deleted: 0, skipped: 0, failed: 0 };

  for (const asset of expired) {
    try {
      await deleteFile(storage, asset.storage_key);
      const updated = rows(
        await db.from("media_assets")
          .update({ status: "DELETED", deleted_at: now })
          .eq("id", asset.id)
          .eq("status", "PENDING")
          .select("id"),
        "mark expired media deleted"
      );
      if (updated.length) summary.deleted += 1;
      else summary.skipped += 1;
    } catch (error) {
      const current = await readAsset(db, asset.id).catch(() => null);
      if (current && current.status === "DELETED") summary.skipped += 1;
      else summary.failed += 1;
      console.error(JSON.stringify({ scope: "media-pending-cleanup", code: error && error.code || "UNEXPECTED" }));
    }
  }
  return summary;
}

module.exports = {
  COMMITTED_TTL_MS,
  DEFAULT_BATCH_SIZE,
  UNCOMMITTED_TTL_MS,
  cleanupExpiredMedia,
  deleteFile,
  isExpired
};
