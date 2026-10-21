const intents = require("./content-intents");
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
  draft.works.forEach((work, index) => {
    if (!work.title) missingFields.push(`works[${index}].title`);
    if (!work.description) missingFields.push(`works[${index}].description`);
    if (work.priceFen != null && (!Number.isSafeInteger(work.priceFen) || work.priceFen <= 0)) missingFields.push(`works[${index}].priceFen`);
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
    schemaVersion: 2,
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

async function handleProviderPublish(db, event = {}, context = {}, now = Date.now(), dependencies = {}) {
  if (event.action === 'cancelPublishIntent') {
    const owner = await resolveProvider(db, context);
    if (!intents.enabled() || !dependencies.mutatePublication || !/^[a-f0-9]{32}$/.test(event.intentId || '')) fail('VALIDATION_ERROR', 'invalid task');
    return dependencies.mutatePublication({ action: 'cancel', owner, intentId: event.intentId });
  }
  if (event.action === "getPublishIntent") {
    const owner = await resolveProvider(db, context);
    if (event.intentId) return intents.status(db, owner, event.intentId);
    if (!intents.enabled() || !Number.isSafeInteger(event.expectedVersion)) return null;
    const draft = await readDraftRow(db, owner);
    if (draft?.version !== event.expectedVersion) return null;
    const pending = await intents.status(db, owner, draft.pending_content_intent_id);
    if (pending) return pending;
    const published = rows(await db.from("provider_catalog_publications").select("draft_version").eq("provider_id", owner), "read publication result")[0];
    return Number(published?.draft_version) === event.expectedVersion ? { status: "APPLIED", expectedVersion: event.expectedVersion } : null;
  }
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
  const publicTexts = [draft.profile.bio, draft.profile.notice, draft.profile.specialties, draft.profile.declines, draft.profile.contactHours, ...(draft.profile.tags || []),
    ...draft.services.flatMap(service => [service.name, service.unit, service.description, service.includes, service.extras, service.preparation]),
    ...draft.works.flatMap(work => [work.title, work.subtitle, work.description, ...(work.tags || []), work.creditCoser, work.creditPhoto, work.creditMakeup, work.creditRetouch, work.creditMine])];
  const review = dependencies.reviewServiceNames || require('./service-name-security').reviewServiceNames;
  // Keep each request under the text API limit; never truncate public content.
  let chunk = [];
  for (const name of publicTexts.filter(Boolean)) {
    if (chunk.join('\n').length + name.length > 2000) { await review(chunk.map(name => ({ name })), context.WX_OPENID || context.OPENID); chunk = []; }
    chunk.push(name);
  }
  if (chunk.length) await review(chunk.map(name => ({ name })), context.WX_OPENID || context.OPENID);
  // Historical suspension remains an enforcement restriction, not an onboarding requirement.
  const qualification = rows(await db.from("provider_qualifications").select("status")
    .eq("provider_id", providerId), "read provider qualification")[0];
  if (qualification && qualification.status === "SUSPENDED") fail("PROVIDER_NOT_AVAILABLE", "provider is suspended");

  const workAssetIds = [...new Set(draft.works.flatMap((work) => [...work.imageAssetIds, ...(work.sourceImageAssetIds || [])]))];
  const noticeAssetIds = draft.profile.noticeImageAssetId ? [draft.profile.noticeImageAssetId] : [];
  const bannerAssetIds = [draft.profile.bannerAssetId, draft.profile.bannerSourceAssetId].filter(Boolean);
  const assetIds = [...new Set([...workAssetIds, ...noticeAssetIds, ...bannerAssetIds])];
  const readyAssets = rows(
    await db.from("media_assets")
      .select("id,purpose,status")
      .in("id", assetIds)
      .eq("owner_account_id", providerId)
      .in("status", intents.enabled() ? ["READY", "PENDING"] : ["READY"]),
    "read publishable media assets"
  );
  const purposeById = new Map(readyAssets.map((asset) => [asset.id, asset.purpose]));
  const invalidAssetIds = [...new Set([
    ...workAssetIds.filter(assetId => purposeById.get(assetId) !== "WORK_IMAGE"),
    ...noticeAssetIds.filter(assetId => purposeById.get(assetId) !== "NOTICE_IMAGE"),
    ...bannerAssetIds.filter(assetId => purposeById.get(assetId) !== "PROVIDER_BANNER")
  ])];
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
  if (intents.enabled() && dependencies.mutatePublication) {
    const requestKey = crypto.createHash('sha256').update(providerId + ':' + String(event.requestKey || event.expectedVersion)).digest('hex');
    return dependencies.mutatePublication({ action: 'stage', owner: providerId, version: draftRow.version, requestKey,
      payload: { assets: readyAssets.map(asset => ({ id: asset.id, purpose: asset.purpose })), publication: payload, previousPublicationVersion: currentPublicationVersion } });
  }
  if (intents.enabled()) fail("CONTENT_INTENT_UNAVAILABLE", "transactional worker is unavailable");
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
