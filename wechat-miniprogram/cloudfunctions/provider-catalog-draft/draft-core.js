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

function normalizeDraft(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("VALIDATION_ERROR", "draft is invalid");
  const profileInput = input.profile || {};
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
      imageAssetIds: stringList(work && work.imageAssetIds, `works[${index}].imageAssetIds`, 5, 64, true)
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
    profile: {
      career,
      city: text(profileInput.city, "profile.city", 120),
      cityCode: profileInput.cityCode ? text(profileInput.cityCode, "profile.cityCode", 6, true) : "",
      bio: text(profileInput.bio, "profile.bio", 1000),
      notice: text(profileInput.notice, "profile.notice", 1000),
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
  const roles = rows(
    await db.from("account_roles").select("role").eq("account_id", accountId).eq("role", "PROVIDER"),
    "read provider role"
  );
  if (!roles.length) fail("PROVIDER_ROLE_REQUIRED", "provider role is required");
  return accountId;
}

async function readDraftRow(db, providerId) {
  const row = rows(
    await db.from("provider_catalog_drafts").select("payload,version,updated_at").eq("provider_id", providerId),
    "read provider draft"
  )[0] || null;
  return row ? { ...row, version: dbVersion(row.version), updated_at: dbTime(row.updated_at) } : null;
}

async function handleProviderDraft(db, event = {}, context = {}, now = Date.now()) {
  const action = event.action || "getDraft";
  if (!new Set(["getDraft", "saveDraft"]).has(action)) fail("INVALID_ACTION", "action is not supported");
  const providerId = await resolveProvider(db, context);
  const current = await readDraftRow(db, providerId);

  if (action === "getDraft") {
    return {
      providerId,
      draft: current ? parsePayload(current.payload) : emptyDraft(),
      version: current ? current.version : 0,
      updatedAt: current ? current.updated_at : null
    };
  }

  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 0) {
    fail("VALIDATION_ERROR", "expectedVersion is required");
  }
  const currentVersion = current ? current.version : 0;
  if (event.expectedVersion !== currentVersion) fail("VERSION_CONFLICT", "draft version has changed");
  const draft = normalizeDraft(event.draft);

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
        .update({ payload: JSON.stringify(draft), version: currentVersion + 1, updated_at: now })
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
