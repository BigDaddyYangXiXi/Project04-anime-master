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

function sanitizedMessage(value) {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b((?:openid|wx_openid)\s*[=:])\s*[^\s,;]+/gi, "$1[redacted-id]")
    .replace(/\bopenid[-_A-Za-z0-9]{2,}\b/gi, "[redacted-id]")
    .slice(0, 256);
}

async function resolveOwner(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted WeChat identity context is missing");
  const identity = rows(
    await db.from("wechat_identities").select("account_id").eq("open_id", openId),
    "read identity"
  )[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  return { accountId: identity.account_id, openId };
}

function publicStatus(status) {
  return status === "PASS" ? "READY" : status === "REVIEW" || status === "RISKY" ? "REJECTED" : "PENDING_SECURITY_REVIEW";
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

  const existing = rows(
    await db.from("media_security_checks")
      .select("asset_id,trace_id,status")
      .eq("asset_id", id),
    "read media security check"
  )[0];

  if (event.action === "getImageStatus") {
    if (asset.status === "DELETED") fail("MEDIA_STATE_INVALID", "media asset was deleted");
    if (asset.status === "READY") return { assetId: id, status: "READY" };
    if (asset.status === "REJECTED") return { assetId: id, status: "REJECTED" };
    return { assetId: id, status: existing ? publicStatus(existing.status) : "PENDING_SECURITY_REVIEW" };
  }

  if (asset.status !== "PENDING") fail("MEDIA_STATE_INVALID", "media asset is not pending review");
  if (!asset.committed_at || !String(asset.storage_key || "").startsWith("cloud://")) {
    fail("MEDIA_NOT_COMMITTED", "media upload is not committed");
  }
  if (existing && existing.status !== "ERROR") {
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
    rows(await db.from("media_security_checks").update(submitting).eq("asset_id", id).eq("status", "ERROR"), "retry media security check");
  } else {
    rows(await db.from("media_security_checks").insert({ asset_id: id, ...submitting }), "create media security check");
  }

  try {
    const urlResult = await storage.getTempFileURL({ fileList: [asset.storage_key] });
    const file = urlResult && urlResult.fileList && urlResult.fileList[0];
    const mediaUrl = file && (file.tempFileURL || file.download_url);
    if (!file || (file.code && file.code !== "SUCCESS") || !/^https:\/\//.test(mediaUrl || "")) {
      fail("MEDIA_URL_UNAVAILABLE", "temporary media URL is unavailable");
    }

    const response = await wxApi.callWxOpenApi({
      apiName: "security.mediaCheckAsync",
      requestData: { media_url: mediaUrl, media_type: 2, version: 2, scene: 1, openid: openId }
    });
    const result = response && response.result;
    const traceId = result && String(result.trace_id || "").trim();
    if ((response && response.code) || !result || Number(result.errcode || 0) !== 0 || !traceId) {
      fail("WECHAT_MEDIA_CHECK_FAILED", "WeChat media check submission failed", {
        providerCode: Number(response && response.code || result && result.errcode || 0),
        providerMessage: String(response && response.message || result && result.errmsg || "").slice(0, 256)
      });
    }

    rows(
      await db.from("media_security_checks")
        .update({ trace_id: traceId, status: "PENDING", updated_at: now })
        .eq("asset_id", id)
        .eq("status", "SUBMITTING"),
      "mark media security check pending"
    );
    return { assetId: id, status: "PENDING_SECURITY_REVIEW" };
  } catch (error) {
    const details = error && error.details || {};
    rows(
      await db.from("media_security_checks")
        .update({
          status: "ERROR",
          detail_json: JSON.stringify([{
            scope: "media-security-submit",
            code: error && error.code || "UNEXPECTED",
            providerCode: Number(details.providerCode || 0),
            providerMessage: sanitizedMessage(details.providerMessage || error && error.message)
          }]),
          resolved_at: now,
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
