function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function rows(result, operation) {
  if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`);
  return (result && result.data) || [];
}

function assetId(value) {
  if (typeof value !== "string" || !/^asset_[a-f0-9]{32}$/.test(value)) {
    fail("VALIDATION_ERROR", "assetId is invalid");
  }
  return value;
}

const FAILURE_CODES = new Set(["MEDIA_URL_UNAVAILABLE", "WECHAT_MEDIA_CHECK_FAILED", "DATABASE_OPERATION_FAILED"]);

async function resolveOwner(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted WeChat identity context is missing");
  const identity = rows(
    await db.from("wechat_identities").select("account_id").eq("open_id", openId),
    "read identity"
  )[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  const account = rows(await db.from("accounts").select("id").eq("id", identity.account_id).eq("status", "ACTIVE"), "read active account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account is not active");
  return { accountId: identity.account_id, openId };
}

function publicStatus(status) {
  // READY is returned only from the asset row; a saved verdict may still need
  // its interrupted asset write repaired by a repeated callback.
  return status === "REVIEW" || status === "RISKY" ? "REJECTED" : "PENDING_SECURITY_REVIEW";
}

async function handleMediaSecurity(db, storage, wxApi, event = {}, context = {}, now = Date.now()) {
  if (!new Set(["submitImage", "getImageStatus"]).has(event.action)) {
    fail("INVALID_ACTION", "action is not supported");
  }
  const id = assetId(event.assetId);
  const { accountId, openId } = await resolveOwner(db, context);
  const asset = rows(
    await db.from("media_assets")
      .select("id,owner_account_id,storage_key,mime_type,status,committed_at")
      .eq("id", id)
      .eq("owner_account_id", accountId),
    "read owned media asset"
  )[0];
  if (!asset) fail("MEDIA_NOT_FOUND", "media asset was not found");
  if (!["image/jpeg", "image/png", "image/webp"].includes(asset.mime_type)) {
    fail("UNSUPPORTED_MEDIA_TYPE", "asset is not a supported image");
  }

  // Terminal asset states do not need a second read of the review record.
  if (event.action === "getImageStatus") {
    if (asset.status === "DELETED") fail("MEDIA_STATE_INVALID", "media asset was deleted");
    if (asset.status === "READY") return { assetId: id, status: "READY" };
    if (asset.status === "REJECTED") return { assetId: id, status: "REJECTED" };
  }
  const existing = rows(
    await db.from("media_security_checks")
      .select("asset_id,trace_id,status")
      .eq("asset_id", id),
    "read media security check"
  )[0];

  if (event.action === "getImageStatus") {
    // A verified callback may have committed its verdict before the asset write
    // failed. Repair only the owner's still-pending asset, never the verdict.
    if (asset.status === "PENDING" && asset.committed_at && existing
      && typeof existing.trace_id === "string" && existing.trace_id.trim()
      && ["PASS", "REVIEW", "RISKY", "ERROR"].includes(existing.status)) {
      const status = existing.status === "PASS" ? "READY" : "REJECTED";
      const updated = rows(await db.from("media_assets").update({ status })
        .eq("id", id).eq("owner_account_id", accountId).eq("status", "PENDING").select("id"),
      "repair media asset from saved verdict");
      if (!updated.length) fail("MEDIA_STATE_CONFLICT", "media asset changed during recovery");
      return { assetId: id, status };
    }
    return { assetId: id, status: existing ? publicStatus(existing.status) : "PENDING_SECURITY_REVIEW" };
  }

  if (asset.status !== "PENDING") fail("MEDIA_STATE_INVALID", "media asset is not pending review");
  if (!asset.committed_at || !String(asset.storage_key || "").startsWith("cloud://")) {
    fail("MEDIA_NOT_COMMITTED", "media upload is not committed");
  }
  // A trace means WeChat already accepted the request, even if the callback
  // verdict is ERROR and its asset write still needs recovery.
  if (existing && (existing.status !== "ERROR" || existing.trace_id != null)) {
    return { assetId: id, status: publicStatus(existing.status) };
  }

  const submitting = {
    trace_id: null,
    status: "SUBMITTING",
    label: null,
    detail_json: null,
    submitted_at: now,
    resolved_at: null,
    updated_at: now
  };
  if (existing) {
    const claimed = rows(await db.from("media_security_checks").update(submitting).eq("asset_id", id).eq("status", "ERROR").is("trace_id", null).select("asset_id"), "retry media security check");
    if (!claimed.length) fail("MEDIA_STATE_CONFLICT", "media check retry already claimed");
  } else {
    rows(await db.from("media_security_checks").insert({ asset_id: id, ...submitting }), "create media security check");
  }

  let mayHaveSubmitted = false;
  let traceId = null;
  try {
    const urlResult = await storage.getTempFileURL({ fileList: [asset.storage_key] });
    const file = urlResult && Array.isArray(urlResult.fileList)
      && urlResult.fileList.find(item => item && item.fileID === asset.storage_key);
    const mediaUrl = file && (file.tempFileURL || file.download_url);
    let parsedUrl;
    try { parsedUrl = new URL(mediaUrl); } catch (_) { /* Rejected below. */ }
    if (!file || (file.code && file.code !== "SUCCESS") || !parsedUrl
      || parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
      fail("MEDIA_URL_UNAVAILABLE", "temporary media URL is unavailable");
    }

    mayHaveSubmitted = true;
    const response = await wxApi.callWxOpenApi({
      apiName: "security.mediaCheckAsync",
      requestData: { media_url: mediaUrl, media_type: 2, version: 2, scene: 1, openid: openId }
    });
    const result = response && response.result;
    traceId = result && typeof result.trace_id === "string" ? result.trace_id.trim() || null : null;
    if (!(response && response.code) && result && Number.isSafeInteger(result.errcode) && result.errcode !== 0) {
      mayHaveSubmitted = false;
    }
    if ((response && response.code) || !result || Number(result.errcode || 0) !== 0 || !traceId) {
      fail("WECHAT_MEDIA_CHECK_FAILED", "WeChat media check submission failed", {
        providerCode: Number(response && response.code || result && result.errcode || 0)
      });
    }

    const pending = rows(
      await db.from("media_security_checks")
        .update({ trace_id: traceId, status: "PENDING", updated_at: now })
        .eq("asset_id", id)
        .eq("status", "SUBMITTING").select("asset_id"),
      "mark media security check pending"
    );
    if (!pending.length) fail("MEDIA_STATE_CONFLICT", "media check state changed before trace persistence");
    return { assetId: id, status: "PENDING_SECURITY_REVIEW" };
  } catch (error) {
    const details = error && error.details || {};
    const code = FAILURE_CODES.has(error && error.code) ? error.code : "UNEXPECTED";
    rows(
      await db.from("media_security_checks")
        .update({
          status: mayHaveSubmitted ? "SUBMITTING" : "ERROR",
          ...(mayHaveSubmitted && traceId ? { trace_id: traceId } : {}),
          detail_json: JSON.stringify([{
            scope: "media-security-submit",
            code,
            providerCode: code === "WECHAT_MEDIA_CHECK_FAILED" && Number.isSafeInteger(details.providerCode) ? details.providerCode : null
          }]),
          resolved_at: mayHaveSubmitted ? null : now,
          updated_at: now
        })
        .eq("asset_id", id)
        .eq("status", "SUBMITTING"),
      "mark media security check failed"
    );
    throw error;
  }
}

module.exports = { handleMediaSecurity };
