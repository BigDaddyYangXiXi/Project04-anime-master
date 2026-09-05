const crypto = require("node:crypto");
const { normalizeDraft, parsePayload, readDraftRow, resolveProvider } = require("./draft-core");

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

function dbVersion(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail("DATABASE_OPERATION_FAILED", `${field} is invalid`);
  return normalized;
}

function workCode(providerId, workId) {
  return `AM-${crypto.createHash("sha256").update(`${providerId}:${workId}`).digest("hex").slice(0, 10).toUpperCase()}`;
}

function validatePublishableDraft(draft, nickname) {
  const missingFields = [];
  if (!String(nickname || "").trim()) missingFields.push("account.nickname");
  if (!draft.profile.career) missingFields.push("profile.career");
  if (!/^\d{6}$/.test(draft.profile.cityCode || "")) missingFields.push("profile.cityCode");
  if (!draft.services.length) missingFields.push("services");
  draft.services.forEach((service, index) => {
    if (!service.name) missingFields.push(`services[${index}].name`);
    if (!service.description) missingFields.push(`services[${index}].description`);
    if (!service.unit) missingFields.push(`services[${index}].unit`);
    if (!Number.isSafeInteger(service.priceFen) || service.priceFen <= 0) missingFields.push(`services[${index}].priceFen`);
    if (service.serviceMode !== "ONLINE" && !service.serviceAreas.length && !draft.profile.cityCode) missingFields.push(`services[${index}].serviceAreas`);
  });
  if (draft.works.length < 3) missingFields.push("works:min3");
  draft.works.forEach((work, index) => {
    if (!work.title) missingFields.push(`works[${index}].title`);
    if (!work.description) missingFields.push(`works[${index}].description`);
    if (!Number.isSafeInteger(work.priceFen) || work.priceFen <= 0) missingFields.push(`works[${index}].priceFen`);
    if (!work.imageAssetIds.length) missingFields.push(`works[${index}].imageAssetIds`);
  });
  if (missingFields.length) {
    fail("PUBLISH_VALIDATION_FAILED", "catalog is incomplete", { missingFields: missingFields.slice(0, 50) });
  }
}

function buildPublicationPayload(draft, providerId, currentPayload) {
  const previous = currentPayload && typeof currentPayload === "object" ? currentPayload : {};
  const previousWorks = new Map((previous.works || []).map((work) => [work.id, work]));
  return {
    schemaVersion: 1,
    profile: draft.profile,
    services: draft.services,
    works: draft.works.map((work) => {
      const old = previousWorks.get(work.id) || {};
      return {
        ...work,
        code: old.code || workCode(providerId, work.id),
        referenceCount: Number.isSafeInteger(old.referenceCount) && old.referenceCount >= 0 ? old.referenceCount : 0
      };
    }),
    pinnedWorkIds: draft.pinnedWorkIds
  };
}

async function handleProviderPublish(db, event = {}, context = {}, now = Date.now()) {
  if (event.action !== "publishDraft") fail("INVALID_ACTION", "action is not supported");
  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 1) {
    fail("VALIDATION_ERROR", "expectedVersion is required");
  }

  const providerId = await resolveProvider(db, context);
  const draftRow = await readDraftRow(db, providerId);
  if (!draftRow) fail("DRAFT_NOT_FOUND", "provider draft was not found");
  if (draftRow.version !== event.expectedVersion) fail("VERSION_CONFLICT", "draft version has changed");

  const draft = normalizeDraft(parsePayload(draftRow.payload));
  const account = rows(
    await db.from("accounts").select("id,nickname,status").eq("id", providerId).eq("status", "ACTIVE"),
    "read provider account"
  )[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "provider account is unavailable");
  validatePublishableDraft(draft, account.nickname);

  const workAssetIds = [...new Set(draft.works.flatMap((work) => work.imageAssetIds))];
  const noticeAssetIds = draft.profile.noticeImageAssetId ? [draft.profile.noticeImageAssetId] : [];
  const assetIds = [...new Set([...workAssetIds, ...noticeAssetIds])];
  const readyAssets = rows(
    await db.from("media_assets")
      .select("id,purpose")
      .in("id", assetIds)
      .eq("owner_account_id", providerId)
      .eq("status", "READY"),
    "read publishable media assets"
  );
  const purposeById = new Map(readyAssets.map((asset) => [asset.id, asset.purpose]));
  const invalidAssetIds = assetIds.filter((assetId) => purposeById.get(assetId) !== (noticeAssetIds.includes(assetId) ? "NOTICE_IMAGE" : "WORK_IMAGE"));
  if (readyAssets.length !== assetIds.length || invalidAssetIds.length) {
    fail("MEDIA_NOT_READY", "catalog media is not ready", { missingAssetCount: assetIds.length - readyAssets.length });
  }

  const current = rows(
    await db.from("provider_catalog_publications")
      .select("payload,draft_version,publication_version,published_at")
      .eq("provider_id", providerId),
    "read current publication"
  )[0] || null;
  const payload = buildPublicationPayload(draft, providerId, current && parsePayload(current.payload));
  const currentPublicationVersion = current ? dbVersion(current.publication_version, "publication version") : 0;
  const nextVersion = currentPublicationVersion + 1;
  const value = {
    payload: JSON.stringify(payload),
    draft_version: draftRow.version,
    publication_version: nextVersion,
    published_at: now,
    updated_at: now
  };

  if (!current) {
    const inserted = await db.from("provider_catalog_publications").insert({ provider_id: providerId, ...value });
    if (inserted && inserted.error) fail("PUBLISH_CONFLICT", "publication changed concurrently");
  } else {
    const updated = rows(
      await db.from("provider_catalog_publications")
        .update(value)
        .eq("provider_id", providerId)
        .eq("publication_version", currentPublicationVersion)
        .select("provider_id"),
      "update publication snapshot"
    );
    if (!updated.length) fail("PUBLISH_CONFLICT", "publication changed concurrently");
  }

  return {
    providerId,
    draftVersion: draftRow.version,
    publicationVersion: nextVersion,
    publishedAt: now,
    worksCount: draft.works.length
  };
}

module.exports = { buildPublicationPayload, handleProviderPublish, validatePublishableDraft, workCode };
