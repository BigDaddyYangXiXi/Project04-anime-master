const intents = require("./content-intents");
const CAREERS = new Set(["妆娘", "毛娘", "摄影", "后期"]);
const TONES = new Set(["coral", "grape", "rose", "blue"]);
const SERVICE_MODES = new Set(["ONSITE", "ONLINE", "BOTH"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function rows(result, operation) {
  if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`);
  return (result && result.data) || [];
}

function dbVersion(value, field = "draft version") {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail("DATABASE_OPERATION_FAILED", `${field} is invalid`);
  return normalized;
}

function dbTime(value, field = "draft timestamp") {
  const normalized = Number(value);
  if (value == null || value === "" || typeof value === "boolean" || !Number.isSafeInteger(normalized) || normalized < 0) fail("DATABASE_OPERATION_FAILED", `${field} is invalid`);
  return normalized;
}

function text(value, field, max, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string") fail("VALIDATION_ERROR", `${field} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) fail("VALIDATION_ERROR", `${field} is required`);
  if (normalized.length > max) fail("VALIDATION_ERROR", `${field} is too long`);
  return normalized;
}

function id(value, field) {
  const normalized = text(value, field, 64, true);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) fail("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function price(value, field) {
  if (value == null || value === "") return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) {
    fail("VALIDATION_ERROR", `${field} is invalid`);
  }
  return value;
}

function stringList(value, field, maxItems, itemMax, idOnly = false) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail("VALIDATION_ERROR", `${field} is invalid`);
  const items = value.map((item, index) => idOnly
    ? id(item, `${field}[${index}]`)
    : text(item, `${field}[${index}]`, itemMax, true));
  if (new Set(items).size !== items.length) fail("VALIDATION_ERROR", `${field} contains duplicates`);
  return items;
}

function region(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("VALIDATION_ERROR", `${field} is invalid`);
  const cityCode = text(value.cityCode, `${field}.cityCode`, 6, true);
  if (!/^\d{6}$/.test(cityCode) || cityCode !== canonicalCityCode(cityCode)) fail("VALIDATION_ERROR", `${field}.cityCode must identify a city`);
  return { cityCode, cityName: text(value.cityName, `${field}.cityName`, 80, true) };
}

function canonicalCityCode(value) {
  if (!/^\d{6}$/.test(value)) return "";
  return new Set(["11", "12", "31", "50", "71", "81", "82"]).has(value.slice(0, 2))
    ? `${value.slice(0, 2)}0000`
    : `${value.slice(0, 4)}00`;
}

function normalizeWatermarks(value, display, sources) {
  if (!Array.isArray(display) || !Array.isArray(sources) || display.length !== sources.length || !Array.isArray(value) || value.length !== display.length) fail('VALIDATION_ERROR', 'image settings must match images');
  return value.map((item, index) => {
    if (item == null) {
      if (display[index] !== sources[index]) fail('VALIDATION_ERROR', 'unmarked image must use its source');
      return null;
    }
    if (typeof item !== 'object' || item.enabled !== true || !['bottom-right','bottom-left','top-right','top-left','center'].includes(item.position)
      || !Number.isFinite(item.size) || item.size < 2 || item.size > 6 || !Number.isFinite(item.opacity) || item.opacity < 20 || item.opacity > 90 || display[index] === sources[index]) fail('VALIDATION_ERROR', 'watermark settings are invalid');
    return { enabled: true, text: text(item.text, 'watermark text', 40, true), position: item.position, size: item.size, opacity: item.opacity };
  });
}

function normalizeDraft(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("VALIDATION_ERROR", "draft is invalid");
  const profileInput = input.profile || {};
  if (profileInput.accepting != null && typeof profileInput.accepting !== "boolean") fail("VALIDATION_ERROR", "profile.accepting must be boolean");
  const career = text(profileInput.career, "profile.career", 20);
  if (career && !CAREERS.has(career)) fail("VALIDATION_ERROR", "profile.career is invalid");

  if (!Array.isArray(input.services || []) || (input.services || []).length > 20) {
    fail("VALIDATION_ERROR", "services is invalid");
  }
  if (!Array.isArray(input.works || []) || (input.works || []).length > 50) {
    fail("VALIDATION_ERROR", "works is invalid");
  }

  const services = (input.services || []).map((service, index) => {
    const serviceMode = text(service && service.serviceMode, `services[${index}].serviceMode`, 16) || "ONSITE";
    if (!SERVICE_MODES.has(serviceMode)) fail("VALIDATION_ERROR", `services[${index}].serviceMode is invalid`);
    const serviceAreas = service && service.serviceAreas == null ? [] : service.serviceAreas;
    if (!Array.isArray(serviceAreas) || serviceAreas.length > 20) fail("VALIDATION_ERROR", `services[${index}].serviceAreas is invalid`);
    const normalizedAreas = serviceAreas.map((item, areaIndex) => region(item, `services[${index}].serviceAreas[${areaIndex}]`));
    if (new Set(normalizedAreas.map((item) => item.cityCode)).size !== normalizedAreas.length) fail("VALIDATION_ERROR", `services[${index}].serviceAreas contains duplicates`);
    return {
      id: id(service && service.id, `services[${index}].id`),
      name: text(service && service.name, `services[${index}].name`, 120),
      priceFen: price(service && service.priceFen, `services[${index}].priceFen`),
      unit: text(service && service.unit, `services[${index}].unit`, 40),
      description: text(service && service.description, `services[${index}].description`, 1000),
      workIds: stringList(service && service.workIds, `services[${index}].workIds`, 50, 64, true),
      serviceMode,
      includes: text(service && service.includes, `services[${index}].includes`, 1000),
      extras: text(service && service.extras, `services[${index}].extras`, 1000),
      preparation: text(service && service.preparation, `services[${index}].preparation`, 1000),
      serviceAreas: normalizedAreas
    };
  });
  if (new Set(services.map((item) => item.id)).size !== services.length) {
    fail("VALIDATION_ERROR", "service ids contain duplicates");
  }

  const works = (input.works || []).map((work, index) => {
    const tone = text(work && work.tone, `works[${index}].tone`, 32) || "coral";
    if (!TONES.has(tone)) fail("VALIDATION_ERROR", `works[${index}].tone is invalid`);
    return {
      id: id(work && work.id, `works[${index}].id`),
      title: text(work && work.title, `works[${index}].title`, 160),
      subtitle: text(work && work.subtitle, `works[${index}].subtitle`, 255),
      priceFen: price(work && work.priceFen, `works[${index}].priceFen`),
      description: text(work && work.description, `works[${index}].description`, 2000),
      tone,
      tags: stringList(work && work.tags, `works[${index}].tags`, 10, 80),
      imageAssetIds: stringList(work && work.imageAssetIds, `works[${index}].imageAssetIds`, 5, 64, true),
      ...Object.fromEntries(['creditCoser','creditPhoto','creditMakeup','creditRetouch','creditMine'].filter(key => work && work[key]).map(key => [key, text(work[key], `works[${index}].${key}`, 100)])),
      ...(work && work.sourceImageAssetIds ? { sourceImageAssetIds: stringList(work.sourceImageAssetIds, `works[${index}].sourceImageAssetIds`, 5, 64, true), watermarks: normalizeWatermarks(work.watermarks, work.imageAssetIds, work.sourceImageAssetIds) } : {})
    };
  });
  if (new Set(works.map((item) => item.id)).size !== works.length) {
    fail("VALIDATION_ERROR", "work ids contain duplicates");
  }

  const workIds = new Set(works.map((item) => item.id));
  const linkedWorkIds = new Set();
  for (const service of services) {
    if (service.workIds.some((workId) => !workIds.has(workId))) {
      fail("VALIDATION_ERROR", "service references an unknown work");
    }
    for (const workId of service.workIds) {
      if (linkedWorkIds.has(workId)) fail("VALIDATION_ERROR", "a work can only belong to one service");
      linkedWorkIds.add(workId);
    }
  }
  const pinnedWorkIds = stringList(input.pinnedWorkIds, "pinnedWorkIds", 2, 64, true);
  if (pinnedWorkIds.some((workId) => !workIds.has(workId))) {
    fail("VALIDATION_ERROR", "pinnedWorkIds references an unknown work");
  }

  const draft = {
    schemaVersion: 2,
    profile: {
      career,
      city: text(profileInput.city, "profile.city", 120),
      cityCode: profileInput.cityCode ? text(profileInput.cityCode, "profile.cityCode", 6, true) : "",
      district: text(profileInput.district, "profile.district", 120),
      specialties: text(profileInput.specialties, "profile.specialties", 500),
      declines: text(profileInput.declines, "profile.declines", 500),
      contactHours: text(profileInput.contactHours, "profile.contactHours", 500),
      accepting: profileInput.accepting !== false,
      bio: text(profileInput.bio, "profile.bio", 1000),
      notice: text(profileInput.notice, "profile.notice", 1000),
      bannerSourceAssetId: profileInput.bannerSourceAssetId ? id(profileInput.bannerSourceAssetId, "profile.bannerSourceAssetId") : null,
      bannerFocusX: Number.isFinite(profileInput.bannerFocusX) ? Math.max(0, Math.min(100, profileInput.bannerFocusX)) : 50,
      bannerFocusY: Number.isFinite(profileInput.bannerFocusY) ? Math.max(0, Math.min(100, profileInput.bannerFocusY)) : 50,
      bannerAssetId: profileInput.bannerAssetId ? id(profileInput.bannerAssetId, "profile.bannerAssetId") : null,
      noticeImageAssetId: profileInput.noticeImageAssetId
        ? id(profileInput.noticeImageAssetId, "profile.noticeImageAssetId")
        : null,
      tags: stringList(profileInput.tags, "profile.tags", 10, 80)
    },
    services,
    works,
    pinnedWorkIds
  };
  if (draft.profile.cityCode && (!/^\d{6}$/.test(draft.profile.cityCode) || draft.profile.cityCode !== canonicalCityCode(draft.profile.cityCode))) fail("VALIDATION_ERROR", "profile.cityCode must identify a city");
  if (Buffer.byteLength(JSON.stringify(draft), "utf8") > 200 * 1024) {
    fail("VALIDATION_ERROR", "draft is too large");
  }
  return draft;
}

function emptyDraft() {
  return { profile: { career: "", city: "", cityCode: "", bio: "", notice: "", noticeImageAssetId: null, tags: [] }, services: [], works: [], pinnedWorkIds: [] };
}

function parsePayload(value) {
  if (!value) return emptyDraft();
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function resolveProvider(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted WeChat identity context is missing");
  const identities = rows(
    await db.from("wechat_identities").select("account_id").eq("open_id", openId),
    "read identity"
  );
  if (!identities[0]) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  const accountId = identities[0].account_id;
  const account = rows(await db.from("accounts").select("id").eq("id", accountId).eq("status", "ACTIVE"), "read active account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account is not active");
  const roles = rows(await db.from("account_roles").select("role").eq("account_id", accountId).eq("role", "PROVIDER"), "read provider role");
  if (!roles.length) fail("PROVIDER_ROLE_REQUIRED", "provider role is required");
  return accountId;
}

async function readDraftRow(db, providerId) {
  const row = rows(
    await db.from("provider_catalog_drafts").select("payload,version,updated_at" + (intents.enabled() ? ",pending_content_intent_id" : "")).eq("provider_id", providerId),
    "read provider draft"
  )[0] || null;
  return row ? { ...row, version: dbVersion(row.version), updated_at: dbTime(row.updated_at) } : null;
}

async function handleProviderDraft(db, event = {}, context = {}, now = Date.now(), dependencies = {}) {
  const action = event.action || "getDraft";
  if (!new Set(["getDraft", "getWorkspaceReview", "saveDraft"]).has(action)) fail("INVALID_ACTION", "action is not supported");
  const providerId = await resolveProvider(db, context);
  const current = await readDraftRow(db, providerId);

  if (action === 'getWorkspaceReview') {
    const publication = rows(await db.from('provider_catalog_publications').select('payload,draft_version,publication_version').eq('provider_id', providerId), 'read owned publication review')[0];
    return { providerId, draftVersion: current ? current.version : 0,
      publication: publication ? parsePayload(publication.payload) : null,
      publicationVersion: publication ? dbVersion(publication.publication_version) : 0,
      publishedDraftVersion: publication ? dbVersion(publication.draft_version) : 0,
      contentIntent: intents.enabled() ? await intents.status(db, providerId, current?.pending_content_intent_id) : null };
  }

  if (action === "getDraft") {
    const draft = current ? parsePayload(current.payload) : emptyDraft();
    const availability = rows(await db.from("provider_availability").select("payload").eq("provider_id", providerId), "read independent accepting state")[0];
    const accepting = availability && parsePayload(availability.payload).accepting;
    if (typeof accepting === "boolean") draft.profile.accepting = accepting;
    return {
      providerId,
      imageEditingVersion: 1,
      storefrontSchemaVersion: 2,
      ...(intents.enabled() ? { deferredPublish: true, contentIntent: await intents.status(db, providerId, current?.pending_content_intent_id) } : {}),
      draft,
      version: current ? current.version : 0,
      updatedAt: current ? current.updated_at : null
    };
  }

  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 0) {
    fail("VALIDATION_ERROR", "expectedVersion is required");
  }
  const currentVersion = current ? current.version : 0;
  if (event.expectedVersion !== currentVersion) fail("VERSION_CONFLICT", "draft version has changed");
  if (current && parsePayload(current.payload).schemaVersion >= 2 && event.schemaVersion !== 2) fail("CLIENT_UPGRADE_REQUIRED", "update client before editing this draft");
  const draft = normalizeDraft(event.draft);
  await (dependencies.reviewServiceNames || require('./service-name-security').reviewServiceNames)(draft.services, context.WX_OPENID || context.OPENID);

  if (!current) {
    rows(await db.from("provider_catalog_drafts").insert({
      provider_id: providerId,
      payload: JSON.stringify(draft),
      version: 1,
      created_at: now,
      updated_at: now
    }), "create provider draft");
  } else {
    const updated = rows(
      await db.from("provider_catalog_drafts")
        .update({ ...(intents.enabled() ? { pending_content_intent_id: null } : {}), payload: JSON.stringify(draft), version: currentVersion + 1, updated_at: now })
        .eq("provider_id", providerId)
        .eq("version", currentVersion)
        .select("version"),
      "update provider draft"
    );
    if (!updated.length) fail("VERSION_CONFLICT", "draft version has changed");
  }

  return { providerId, draft, version: currentVersion + 1, updatedAt: now };
}

module.exports = {
  emptyDraft,
  handleProviderDraft,
  normalizeDraft,
  parsePayload,
  readDraftRow,
  resolveProvider
};
