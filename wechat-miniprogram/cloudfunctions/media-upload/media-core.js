const crypto = require("node:crypto");

// WeChat mediaCheckAsync only accepts a single file up to 10 MB.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DELIVERY_BYTES = 20 * 1024 * 1024;
const PURPOSES = new Set(["AVATAR", "NOTICE_IMAGE", "PROVIDER_BANNER", "WORK_IMAGE", "PROJECT_REFERENCE", "PROJECT_TARGET", "ORDER_DELIVERY", "SUPPORT_IMAGE"]);
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["application/zip", "zip"],
  ["application/x-zip-compressed", "zip"],
  ["text/plain", "txt"]
]);
const IMAGE_PURPOSES = new Set(["AVATAR", "NOTICE_IMAGE", "PROVIDER_BANNER", "WORK_IMAGE", "PROJECT_REFERENCE", "PROJECT_TARGET", "SUPPORT_IMAGE"]);

function fail(code, message, reason) {
  const error = new Error(message);
  error.code = code;
  if (reason) error.reason = reason;
  throw error;
}

function rows(result, operation) {
  if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`);
  return (result && result.data) || [];
}

function boundedText(value, field, max, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string") fail("VALIDATION_ERROR", `${field} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) fail("VALIDATION_ERROR", `${field} is required`);
  if (normalized.length > max) fail("VALIDATION_ERROR", `${field} is too long`);
  return normalized;
}

function assetId(value) {
  const normalized = boundedText(value, "assetId", 64, true);
  if (!/^asset_[a-f0-9]{32}$/.test(normalized)) fail("VALIDATION_ERROR", "assetId is invalid");
  return normalized;
}

function validateFileId(fileId, cloudPath, envId) {
  if (typeof envId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(envId)) {
    fail("MEDIA_ENV_NOT_CONFIGURED", "trusted runtime environment is missing");
  }
  const normalized = boundedText(fileId, "fileId", 1024, true);
  let decoded;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    fail("FILE_ID_MISMATCH", "fileId encoding is invalid");
  }
  const parts = /^cloud:\/\/([^/.]+)\.([^/]+)\/(.+)$/.exec(decoded);
  if (!parts || parts[1] !== envId || parts[3] !== cloudPath) {
    fail("FILE_ID_MISMATCH", "fileId does not match the issued upload path");
  }
  return normalized;
}

async function resolveAccount(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted WeChat identity context is missing");
  const identities = rows(
    await db.from("wechat_identities").select("account_id").eq("open_id", openId),
    "read identity"
  );
  if (!identities[0]) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  const account = rows(await db.from("accounts").select("id").eq("id", identities[0].account_id).eq("status", "ACTIVE"), "read active account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account is not active");
  return identities[0].account_id;
}

async function readOwnedAsset(db, id, accountId) {
  return rows(
    await db.from("media_assets")
      .select("id,owner_account_id,purpose,scope_id,storage_key,original_filename,mime_type,size_bytes,status,committed_at,deleted_at")
      .eq("id", id)
      .eq("owner_account_id", accountId),
    "read owned media asset"
  )[0] || null;
}

function assetIdList(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) fail("VALIDATION_ERROR", "assetIds is invalid");
  const ids = value.map(assetId);
  if (new Set(ids).size !== ids.length) fail("VALIDATION_ERROR", "assetIds contains duplicates");
  return ids;
}

async function getOwnedMedia(db, event, accountId) {
  const ids = assetIdList(event.assetIds);
  const assets = rows(
    await db.from("media_assets")
      .select("id,storage_key,mime_type,size_bytes,status,committed_at")
      .in("id", ids)
      .eq("owner_account_id", accountId),
    "read owned media assets"
  );
  return {
    assets: assets.map((item) => ({
      assetId: item.id,
      fileId: item.committed_at && String(item.storage_key || "").startsWith("cloud://") ? item.storage_key : null,
      mimeType: item.mime_type,
      sizeBytes: item.size_bytes,
      status: item.status === "READY" ? "READY" : item.status === "REJECTED" || item.status === "DELETED" ? item.status : "PENDING_SECURITY_REVIEW"
    }))
  };
}

async function prepareUpload(db, event, accountId, now, uuid = crypto.randomUUID) {
  const purpose = boundedText(event.purpose, "purpose", 32, true).toUpperCase();
  if (!PURPOSES.has(purpose)) fail("VALIDATION_ERROR", "purpose is invalid");
  const declaredMime = boundedText(event.mimeType, "mimeType", 128, true).toLowerCase();
  const extension = MIME_EXTENSIONS.get(declaredMime);
  if (!extension || (IMAGE_PURPOSES.has(purpose) && !declaredMime.startsWith("image/"))) fail("UNSUPPORTED_MEDIA_TYPE", "media type is not supported");
  const maxBytes = purpose === "ORDER_DELIVERY" ? MAX_DELIVERY_BYTES : MAX_IMAGE_BYTES;
  if (!Number.isSafeInteger(event.sizeBytes) || event.sizeBytes <= 0 || event.sizeBytes > maxBytes) {
    fail("MEDIA_SIZE_INVALID", "media size is invalid");
  }

  let scopeId = null;
  if (purpose === "ORDER_DELIVERY") {
    scopeId = boundedText(event.scopeId, "scopeId", 64, true);
    if (!/^ord_[a-f0-9]{32}$/.test(scopeId)) fail("VALIDATION_ERROR", "scopeId is invalid");
    const order = rows(await db.from("order_aggregates").select("id,stage").eq("id", scopeId).eq("provider_id", accountId), "read delivery order")[0];
    if (!order) fail("DELIVERY_ORDER_NOT_FOUND", "delivery order was not found");
    if (!new Set(["IN_PRODUCTION", "REVISION_REQUESTED"]).has(order.stage)) fail("DELIVERY_ORDER_STATE_INVALID", "delivery upload is not allowed for this order state");
  }

  const id = `asset_${uuid().replace(/-/g, "").toLowerCase()}`;
  const scopePath = scopeId ? `/${scopeId}` : "";
  const cloudPath = `user-uploads/${accountId}/${purpose.toLowerCase()}${scopePath}/${id}.${extension}`;
  const expiresAt = now + 60 * 60 * 1000;
  rows(await db.from("media_assets").insert({
    id,
    owner_account_id: accountId,
    purpose,
    scope_id: scopeId,
    storage_key: cloudPath,
    original_filename: boundedText(event.originalFilename, "originalFilename", 255) || null,
    mime_type: declaredMime,
    size_bytes: event.sizeBytes,
    width: null,
    height: null,
    sha256: null,
    status: "PENDING",
    created_at: now,
    committed_at: null,
    deleted_at: null
  }), "create pending media asset");

  return {
    assetId: id,
    cloudPath,
    expiresAt,
    maxBytes,
    allowedMimeTypes: purpose === "ORDER_DELIVERY" ? [...MIME_EXTENSIONS.keys()] : [...MIME_EXTENSIONS.keys()].filter((item) => item.startsWith("image/"))
  };
}

async function commitUpload(db, storage, event, accountId, now, envId) {
  const id = assetId(event.assetId);
  const asset = await readOwnedAsset(db, id, accountId);
  if (!asset || asset.status === "DELETED") fail("MEDIA_NOT_FOUND", "media asset was not found");
  if (asset.committed_at && asset.storage_key.startsWith("cloud://")) {
    if (!["PENDING", "READY", "REJECTED"].includes(asset.status)) fail("MEDIA_STATE_INVALID", "media asset cannot be committed");
    return { assetId: id, fileId: asset.storage_key, status: asset.status === "PENDING" ? "PENDING_SECURITY_REVIEW" : asset.status, mimeType: asset.mime_type, sizeBytes: asset.size_bytes };
  }
  if (asset.status !== "PENDING") fail("MEDIA_STATE_INVALID", "media asset cannot be committed");

  const fileId = validateFileId(event.fileId, asset.storage_key, envId);
  const infoResult = await storage.getFileInfo({ fileList: [fileId] });
  const matches = infoResult && Array.isArray(infoResult.fileList)
    ? infoResult.fileList.filter(item => item && item.fileID === fileId) : [];
  const info = matches.length === 1 ? matches[0] : null;
  if (!info || info.code !== "SUCCESS") fail("MEDIA_FILE_MISSING", "uploaded file was not found");
  const mime = boundedText(info.mime || info.contentType, "uploaded mime", 128).toLowerCase();
  const size = Number(info.size);
  const maxBytes = asset.purpose === "ORDER_DELIVERY" ? MAX_DELIVERY_BYTES : MAX_IMAGE_BYTES;
  if (!MIME_EXTENSIONS.has(mime) || (IMAGE_PURPOSES.has(asset.purpose) && !mime.startsWith("image/"))
    || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
    rows(await db.from("media_assets")
      .update({ status: "REJECTED", mime_type: mime || asset.mime_type, size_bytes: Number.isFinite(size) ? size : 0, deleted_at: now })
      .eq("id", id)
      .eq("owner_account_id", accountId)
      .eq("status", "PENDING"), "reject invalid media asset");
    fail("MEDIA_FILE_REJECTED", "uploaded file failed size or type validation");
  }

  const nextStatus = asset.purpose === "ORDER_DELIVERY" ? "READY" : undefined;
  const update = { storage_key: fileId, mime_type: mime, size_bytes: size, committed_at: now };
  if (nextStatus) update.status = nextStatus;
  const updated = rows(
    await db.from("media_assets")
      .update(update)
      .eq("id", id)
      .eq("owner_account_id", accountId)
      .eq("status", "PENDING")
      .is("committed_at", null)
      .select("id"),
    "commit uploaded media asset"
  );
  if (!updated.length) fail("MEDIA_STATE_CONFLICT", "media asset changed during commit");
  return { assetId: id, fileId, status: nextStatus || "PENDING_SECURITY_REVIEW", mimeType: mime, sizeBytes: size };
}

async function cancelUpload(db, storage, event, accountId, now, envId) {
  const id = assetId(event.assetId);
  const asset = await readOwnedAsset(db, id, accountId);
  if (!asset) fail("MEDIA_NOT_FOUND", "media asset was not found");
  if (asset.status === "DELETED") return { assetId: id, status: "DELETED" };
  if (!["PENDING", "REJECTED"].includes(asset.status)) {
    fail("MEDIA_STATE_INVALID", "usable media is managed by reference-aware cleanup");
  }

  let fileId = asset.storage_key.startsWith("cloud://") ? asset.storage_key : null;
  if (!fileId && event.fileId) fileId = validateFileId(event.fileId, asset.storage_key, envId);
  // Make the asset unusable before touching storage. A concurrent commit/review
  // must not turn a file being deleted into READY. REJECTED also permits retry.
  let claim = db.from("media_assets").update({ status: "REJECTED", deleted_at: now })
    .eq("id", id).eq("owner_account_id", accountId).eq("status", asset.status).eq("storage_key", asset.storage_key);
  claim = asset.committed_at == null ? claim.is("committed_at", null) : claim.eq("committed_at", asset.committed_at);
  if (!rows(await claim.select("id"), "claim media cancellation").length) fail("MEDIA_STATE_CONFLICT", "media asset changed during cancellation");
  if (!fileId) {
    const metadata = await storage.getUploadMetadata({ cloudPath: asset.storage_key });
    if (metadata && metadata.code) fail("MEDIA_DELETE_FAILED", "storage metadata could not be resolved", "METADATA_REJECTED");
    fileId = validateFileId(metadata && metadata.data && metadata.data.fileId, asset.storage_key, envId);
  }
  if (fileId) {
    const deleted = await storage.deleteFile({ fileList: [fileId] });
    const item = deleted && deleted.fileList && deleted.fileList[0];
    if (!item || item.code !== "SUCCESS" || item.fileID !== fileId) {
      const reason = !item ? "MISSING_RECEIPT" : item.fileID !== fileId ? "RECEIPT_FILE_MISMATCH"
        : item.code === "STORAGE_FILE_NONEXIST" ? "STORAGE_NONEXIST" : "STORAGE_REJECTED";
      fail("MEDIA_DELETE_FAILED", "uploaded file could not be deleted", reason);
    }
  }

  const updated = rows(await db.from("media_assets")
    .update({ status: "DELETED", deleted_at: now })
    .eq("id", id)
    .eq("owner_account_id", accountId)
    .eq("status", "REJECTED").select("id"), "mark media asset deleted");
  if (!updated.length) {
    const current = await readOwnedAsset(db, id, accountId);
    if (!current || current.status !== "DELETED") fail("MEDIA_STATE_CONFLICT", "media asset changed during cancellation");
  }
  return { assetId: id, status: "DELETED" };
}

async function handleMediaUpload(db, storage, event = {}, context = {}, now = Date.now(), uuid) {
  const action = event.action;
  if (!new Set(["prepareUpload", "commitUpload", "cancelUpload", "getOwnedMedia"]).has(action)) {
    fail("INVALID_ACTION", "action is not supported");
  }
  const accountId = await resolveAccount(db, context);
  // Context comes from the server SDK, never from the request payload.
  const envId = context.TCB_ENV || context.SCF_NAMESPACE;
  if (action === "prepareUpload") return prepareUpload(db, event, accountId, now, uuid);
  if (action === "commitUpload") return commitUpload(db, storage, event, accountId, now, envId);
  if (action === "getOwnedMedia") return getOwnedMedia(db, event, accountId);
  return cancelUpload(db, storage, event, accountId, now, envId);
}

module.exports = { MAX_DELIVERY_BYTES, MAX_IMAGE_BYTES, getOwnedMedia, handleMediaUpload, validateFileId };
