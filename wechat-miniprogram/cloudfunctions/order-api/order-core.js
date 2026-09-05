const crypto = require("node:crypto");

const TRANSITIONS = {
  REQUESTED: { PROVIDER_INTERESTED: ["CONTACTING", "PROVIDER"], PROVIDER_REQUESTS_SUPPLEMENT: ["SUPPLEMENT_REQUESTED", "PROVIDER"], PROVIDER_DECLINES: ["DECLINED", "PROVIDER"] },
  SUPPLEMENT_REQUESTED: { BUYER_SUPPLEMENTS: ["SUPPLEMENTED", "BUYER"] },
  SUPPLEMENTED: { PROVIDER_INTERESTED: ["CONTACTING", "PROVIDER"], PROVIDER_REQUESTS_SUPPLEMENT: ["SUPPLEMENT_REQUESTED", "PROVIDER"], PROVIDER_DECLINES: ["DECLINED", "PROVIDER"] },
  CONTACTING: {
    PROVIDER_LOCKS_QUOTE: ["CONTACTING", "PROVIDER"],
    PROVIDER_RECORDS_CONTACT: ["CONTACTING", "PROVIDER"],
    PROVIDER_ENDS_COMMUNICATION: [null, "PROVIDER"],
    PROVIDER_ENDS_COMMUNICATION_FAILED: ["DECLINED", "PROVIDER"]
  },
  NDA_BUYER_PENDING: { BUYER_SIGNS_NDA: ["NDA_PROVIDER_PENDING", "BUYER"] },
  NDA_PROVIDER_PENDING: { PROVIDER_SIGNS_NDA: ["BUYER_FINAL_CONFIRM", "PROVIDER"] },
  BUYER_FINAL_CONFIRM: {
    BUYER_CONFIRMS_AGREEMENT: ["BUYER_FINAL_CONFIRM", "BUYER"],
    BUYER_CONFIRMS_EXECUTION: ["IN_PRODUCTION", "BUYER"]
  },
  IN_PRODUCTION: {
    PROVIDER_UPDATES_PROGRESS: ["IN_PRODUCTION", "PROVIDER"],
    PROVIDER_SUBMITS_DELIVERY: ["DELIVERY_PENDING", "PROVIDER"]
  },
  REVISION_REQUESTED: {
    PROVIDER_UPDATES_PROGRESS: ["REVISION_REQUESTED", "PROVIDER"],
    PROVIDER_SUBMITS_DELIVERY: ["DELIVERY_PENDING", "PROVIDER"]
  },
  DELIVERY_PENDING: {
    BUYER_REQUESTS_REVISION: ["REVISION_REQUESTED", "BUYER"],
    BUYER_ACCEPTS_DELIVERY: ["COMPLETED", "BUYER"],
    BUYER_ACCEPTS_AND_SETTLES: ["COMPLETED", "BUYER"]
  },
  COMPLETED: {
    BUYER_SUBMITS_REVIEW: ["COMPLETED", "BUYER"],
    PROVIDER_REPLIES_REVIEW: ["COMPLETED", "PROVIDER"]
  }
};

const MAX_DELIVERY_BYTES = 20 * 1024 * 1024;
const MAX_DELIVERY_FILES = 5;
const DELIVERY_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "application/pdf",
  "application/zip", "application/x-zip-compressed", "text/plain"
]);

function dbVersion(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail("DATABASE_OPERATION_FAILED", "order version is invalid");
  return normalized;
}

function dbTime(value, field) {
  const normalized = Number(value);
  if (value == null || value === "" || typeof value === "boolean" || !Number.isSafeInteger(normalized) || normalized < 0) fail("DATABASE_OPERATION_FAILED", `${field} is invalid`);
  return normalized;
}

function fail(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  throw error;
}

function rows(result, operation) {
  if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`);
  return result && result.data || [];
}

function text(value, field, min, max) {
  if (typeof value !== "string") fail("VALIDATION_ERROR", `${field} is invalid`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) fail("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function safeId(value, field) {
  const normalized = text(value, field, 1, 64);
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) fail("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function optionalText(value, field, max) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") fail("VALIDATION_ERROR", `${field} is invalid`);
  const normalized = value.trim();
  if (normalized.length > max) fail("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}

function canonicalCityCode(value) {
  if (!/^\d{6}$/.test(value)) return "";
  return new Set(["11", "12", "31", "50", "71", "81", "82"]).has(value.slice(0, 2))
    ? `${value.slice(0, 2)}0000`
    : `${value.slice(0, 4)}00`;
}

function parsePayload(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function isOnsiteOrder(payload) {
  return ["妆娘", "毛娘"].includes(payload.public.provider && payload.public.provider.career);
}

function deliveryAssetId(value) {
  const normalized = text(value, "deliveryFiles.assetId", 1, 64);
  if (!/^asset_[a-f0-9]{32}$/.test(normalized)) fail("DELIVERY_FILE_INVALID", "delivery asset id is invalid");
  return normalized;
}

function deliveryFileId(value, orderId) {
  const normalized = text(value, "deliveryFiles.fileId", 1, 1024);
  let decoded;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    fail("DELIVERY_FILE_INVALID", "delivery file encoding is invalid");
  }
  const expected = new RegExp(`^cloud://[^/]+/user-uploads/[A-Za-z0-9_-]+/order_delivery/${orderId}/asset_[a-f0-9]{32}\\.(?:jpg|png|webp|pdf|zip|txt)$`, "i");
  if (!expected.test(decoded)) fail("DELIVERY_FILE_INVALID", "delivery file path is invalid");
  return normalized;
}

async function normalizeDeliveryFiles(db, storage, value, orderId, ownerAccountId) {
  if (!storage || typeof storage.getFileInfo !== "function") fail("SERVICE_CONFIGURATION_ERROR", "delivery storage is unavailable");
  if (!Array.isArray(value) || !value.length || value.length > MAX_DELIVERY_FILES) fail("DELIVERY_FILES_REQUIRED", "delivery files are required");
  const requested = value.map((item, index) => ({
    name: text(item && item.name, `deliveryFiles[${index}].name`, 1, 255),
    assetId: deliveryAssetId(item && item.assetId),
    fileId: deliveryFileId(item && item.fileId, orderId)
  }));
  if (new Set(requested.map((item) => item.assetId)).size !== requested.length
    || new Set(requested.map((item) => item.fileId)).size !== requested.length) fail("DELIVERY_FILE_INVALID", "delivery files contain duplicates");
  for (const item of requested) {
    const asset = rows(await db.from("media_assets").select("id,storage_key,mime_type,size_bytes")
      .eq("id", item.assetId).eq("owner_account_id", ownerAccountId).eq("purpose", "ORDER_DELIVERY")
      .eq("scope_id", orderId).eq("status", "READY"), "read delivery media asset")[0];
    if (!asset || asset.storage_key !== item.fileId) fail("DELIVERY_FILE_INVALID", "delivery asset is not ready or bound to this order");
  }
  const result = await storage.getFileInfo({ fileList: requested.map((item) => item.fileId) });
  const infoById = new Map(((result && result.fileList) || []).map((item) => [item.fileID || item.fileId, item]));
  return requested.map((item) => {
    const info = infoById.get(item.fileId);
    const mimeType = String(info && (info.mime || info.contentType) || "").toLowerCase();
    const sizeBytes = Number(info && info.size);
    if (!info || info.code !== "SUCCESS" || !DELIVERY_MIME_TYPES.has(mimeType)
      || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_DELIVERY_BYTES) {
      fail("DELIVERY_FILE_INVALID", "delivery file failed server validation");
    }
    return { name: item.name, assetId: item.assetId, fileId: item.fileId, mimeType, sizeBytes };
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function requestHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function encryptionKey(value) {
  const key = Buffer.from(String(value || ""), "base64");
  if (key.length !== 32) fail("SERVICE_CONFIGURATION_ERROR", "order contact encryption key is unavailable");
  return key;
}

function encryptContact(contact, keyValue, randomBytes = crypto.randomBytes) {
  const normalized = {
    name: text(contact && contact.name, "contact.name", 1, 80),
    wechat: contact && contact.wechat ? text(contact.wechat, "contact.wechat", 1, 120) : "",
    phone: contact && contact.phone ? text(contact.phone, "contact.phone", 5, 32) : ""
  };
  if (!normalized.wechat && !normalized.phone) fail("VALIDATION_ERROR", "contact channel is required");
  const iv = randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalized), "utf8"), cipher.final()]);
  return { algorithm: "A256GCM", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function decryptContact(encrypted, keyValue) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(keyValue), Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}

async function resolveActor(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted identity is missing");
  const identity = rows(await db.from("wechat_identities").select("account_id").eq("open_id", openId), "read actor identity")[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  const [rolesResult, accountResult] = await Promise.all([
    db.from("account_roles").select("role").eq("account_id", identity.account_id),
    db.from("accounts").select("id,uid,nickname,status").eq("id", identity.account_id).eq("status", "ACTIVE")
  ]);
  const roles = rows(rolesResult, "read actor roles").map((item) => item.role);
  const account = rows(accountResult, "read actor account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account is unavailable");
  return { accountId: identity.account_id, roles, account };
}

function normalizeCreate(event) {
  const serviceIds = (event.serviceIds || []).map((id, index) => safeId(id, `serviceIds[${index}]`));
  if (!serviceIds.length || serviceIds.length > 20 || new Set(serviceIds).size !== serviceIds.length) fail("VALIDATION_ERROR", "serviceIds is invalid");
  const segments = event.timeSegments;
  if (!Array.isArray(segments) || !segments.length || segments.length > 8) fail("VALIDATION_ERROR", "timeSegments is invalid");
  const timeSegments = segments.map((segment, index) => {
    if (!Number.isSafeInteger(segment.startsAt) || !Number.isSafeInteger(segment.endsAt) || segment.endsAt <= segment.startsAt) fail("VALIDATION_ERROR", `timeSegments[${index}] is invalid`);
    return { startsAt: segment.startsAt, endsAt: segment.endsAt };
  });
  const cityCode = String(event.cityCode || "").trim();
  if (!/^\d{6}$/.test(cityCode) || cityCode !== canonicalCityCode(cityCode)) fail("VALIDATION_ERROR", "cityCode must identify a city");
  return {
    providerId: safeId(event.providerId, "providerId"),
    serviceIds,
    referenceWorkId: event.referenceWorkId ? safeId(event.referenceWorkId, "referenceWorkId") : null,
    referenceAssetId: event.referenceAssetId ? safeId(event.referenceAssetId, "referenceAssetId") : null,
    city: text(event.city, "city", 1, 120),
    cityCode,
    location: event.location ? text(event.location, "location", 1, 255) : "",
    requirement: text(event.requirement, "requirement", 10, 500),
    timeSegments,
    contact: event.contact,
    idempotencyKey: text(event.idempotencyKey, "idempotencyKey", 16, 128)
  };
}

function serviceSupportsCity(service, profile, cityCode) {
  const mode = service.serviceMode || "ONSITE";
  if (mode === "ONLINE" || mode === "BOTH") return true;
  return profile && profile.cityCode === cityCode || (service.serviceAreas || []).some((area) => area && area.cityCode === cityCode);
}

function serviceLocationMatch(service, profile, cityCode) {
  const mode = service.serviceMode || "ONSITE";
  const local = profile && profile.cityCode === cityCode;
  const covered = (service.serviceAreas || []).some((area) => area && area.cityCode === cityCode);
  if (mode === "BOTH" && local) return "LOCAL_OR_ONLINE";
  if (mode === "BOTH" && covered) return "SERVICE_AREA_OR_ONLINE";
  if (mode === "ONSITE" && local) return "LOCAL";
  if (mode === "ONSITE" && covered) return "SERVICE_AREA";
  if (mode === "ONLINE" || mode === "BOTH") return "ONLINE";
  return null;
}

function participantRole(row, accountId) {
  if (row.buyer_id === accountId) return "BUYER";
  if (row.provider_id === accountId) return "PROVIDER";
  fail("ORDER_NOT_FOUND", "order was not found");
}

function publicOrder(row, keyValue, actorId) {
  const payload = parsePayload(row.payload);
  const contactVisible = ["CONTACTING", "NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING", "COMPLETED"].includes(row.stage);
  return {
    id: row.id, buyerId: row.buyer_id, providerId: row.provider_id,
    viewerRole: actorId ? participantRole(row, actorId) : null,
    stage: row.stage, version: dbVersion(row.version), createdAt: dbTime(row.created_at, "order createdAt"), updatedAt: dbTime(row.updated_at, "order updatedAt"),
    ...payload.public,
    contact: contactVisible ? decryptContact(payload.contactEncrypted, keyValue) : null,
    events: payload.events
  };
}

async function createOrder(db, event, context, keyValue, now, uuid) {
  const actor = await resolveActor(db, context);
  if (!actor.roles.includes("BUYER")) fail("BUYER_ROLE_REQUIRED", "buyer role is required");
  const input = normalizeCreate(event);
  const orderedSegments = input.timeSegments.slice().sort((left, right) => left.startsAt - right.startsAt);
  if (orderedSegments.some((segment) => segment.startsAt < now)
    || orderedSegments.some((segment, index) => index > 0 && segment.startsAt < orderedSegments[index - 1].endsAt)) {
    fail("INVALID_TIME_SEGMENTS", "time segments must be future and non-overlapping");
  }
  if (input.providerId === actor.accountId) fail("SELF_ORDER_NOT_ALLOWED", "buyer and provider must differ");
  const hash = requestHash(input);
  const existing = rows(await db.from("order_aggregates").select("*").eq("buyer_id", actor.accountId).eq("request_idempotency_key", input.idempotencyKey), "read idempotent order")[0];
  if (existing) {
    if (existing.request_hash !== hash) fail("IDEMPOTENCY_CONFLICT", "idempotency key payload differs");
    return publicOrder(existing, keyValue, actor.accountId);
  }
  const publication = rows(await db.from("provider_catalog_publications").select("provider_id,payload,publication_version").eq("provider_id", input.providerId), "read provider publication")[0];
  if (!publication) fail("PROVIDER_NOT_PUBLISHED", "provider is not published");
  const catalog = parsePayload(publication.payload);
  const providerAccount = rows(
    await db.from("accounts").select("id,uid,nickname,status").eq("id", input.providerId).eq("status", "ACTIVE"),
    "read provider account"
  )[0];
  if (!providerAccount) fail("PROVIDER_NOT_AVAILABLE", "provider account is unavailable");
  const serviceById = new Map((catalog.services || []).map((item) => [item.id, item]));
  const services = input.serviceIds.map((id) => serviceById.get(id));
  if (services.some((item) => !item)) fail("SERVICE_NOT_PUBLISHED", "service is not published");
  if (services.some((item) => !serviceSupportsCity(item, catalog.profile, input.cityCode))) fail("SERVICE_CITY_UNAVAILABLE", "service is unavailable in the selected city");
  if (input.referenceWorkId && !(catalog.works || []).some((work) => work.id === input.referenceWorkId)) fail("WORK_NOT_PUBLISHED", "work is not published");
  if (input.referenceAssetId) {
    const asset = rows(
      await db.from("media_assets").select("id").eq("id", input.referenceAssetId).eq("owner_account_id", actor.accountId).eq("purpose", "PROJECT_REFERENCE").eq("status", "READY"),
      "read order reference"
    )[0];
    if (!asset) fail("REFERENCE_MEDIA_NOT_READY", "reference image is not ready or owned by buyer");
  }
  const items = services.map((service) => ({
    serviceId: service.id, name: service.name, unit: service.unit,
    serviceMode: service.serviceMode || "ONSITE",
    locationMatch: serviceLocationMatch(service, catalog.profile, input.cityCode),
    displayPriceFen: service.priceFen, finalPriceFen: service.priceFen
  }));
  const amountFen = items.reduce((sum, item) => sum + item.finalPriceFen, 0);
  const id = `ord_${uuid().replace(/-/g, "")}`;
  const payload = {
    schemaVersion: 1,
    public: {
      buyer: { id: actor.account.id, uid: actor.account.uid, nickname: actor.account.nickname },
      provider: { id: providerAccount.id, uid: providerAccount.uid, nickname: providerAccount.nickname, career: catalog.profile && catalog.profile.career || "" },
      city: input.city, cityCode: input.cityCode, location: input.location, requirement: input.requirement,
      referenceWorkId: input.referenceWorkId, referenceAssetId: input.referenceAssetId,
      timeSegments: input.timeSegments, items, amountFen,
      supplementNote: "", declinePhase: "", contactFirstCopiedAt: null,
      communicationDone: false, timePlaceConfirmed: false, serviceScopeConfirmed: false,
      ndaRequired: null, amountConfirmed: false, executable: false,
      buyerNdaSigned: false, providerNdaSigned: false, buyerAgreementConfirmedAt: null,
      priceEdited: false, paymentStatus: "UNPAID",
      progress: 0, deliveryNote: "", deliveryFiles: [], deliveryHistory: [],
      revisionNote: "", revisionCount: 0, completedAt: null,
      rating: 0, reviewText: "", reviewedAt: null, reviewReply: "", reviewRepliedAt: null
    },
    contactEncrypted: encryptContact(input.contact, keyValue),
    events: [{ id: `evt_${uuid().replace(/-/g, "")}`, event: "ORDER_CREATED", actorId: actor.accountId, fromStage: null, toStage: "REQUESTED", detail: "", createdAt: now }]
  };
  const row = { id, buyer_id: actor.accountId, provider_id: input.providerId, request_idempotency_key: input.idempotencyKey, request_hash: hash, stage: "REQUESTED", payload: JSON.stringify(payload), version: 1, created_at: now, updated_at: now };
  rows(await db.from("order_aggregates").insert(row), "create order");
  return publicOrder(row, keyValue, actor.accountId);
}

function normalizeQuoteItems(value, currentItems) {
  if (!Array.isArray(value) || value.length !== currentItems.length) fail("VALIDATION_ERROR", "quote items are invalid");
  const currentById = new Map(currentItems.map((item) => [item.serviceId, item]));
  const normalized = value.map((item, index) => {
    const serviceId = safeId(item && item.serviceId, `items[${index}].serviceId`);
    const current = currentById.get(serviceId);
    if (!current || !Number.isSafeInteger(item.finalPriceFen)) fail("VALIDATION_ERROR", "quote items are invalid");
    const minimum = Math.ceil(current.displayPriceFen * 0.85);
    const maximum = Math.floor(current.displayPriceFen * 1.15);
    if (item.finalPriceFen < minimum || item.finalPriceFen > maximum) fail("QUOTE_OUT_OF_RANGE", "quote is outside the allowed range");
    return { ...current, finalPriceFen: item.finalPriceFen };
  });
  if (new Set(normalized.map((item) => item.serviceId)).size !== currentItems.length) fail("VALIDATION_ERROR", "quote items are invalid");
  return normalized;
}

async function readOrder(db, orderId, actorId) {
  const row = rows(await db.from("order_aggregates").select("*").eq("id", safeId(orderId, "orderId")), "read order")[0];
  if (!row) fail("ORDER_NOT_FOUND", "order was not found");
  const role = participantRole(row, actorId);
  return { row: { ...row, version: dbVersion(row.version) }, role };
}

async function transition(db, event, context, keyValue, now, uuid, storage) {
  const actor = await resolveActor(db, context);
  const { row, role } = await readOrder(db, event.orderId, actor.accountId);
  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion !== row.version) fail("VERSION_CONFLICT", "order version changed");
  const rule = TRANSITIONS[row.stage] && TRANSITIONS[row.stage][event.event];
  if (!rule) fail("ILLEGAL_TRANSITION", "order transition is not allowed");
  if (rule[1] !== role) fail("ORDER_ROLE_FORBIDDEN", "actor role cannot perform transition");
  const payload = parsePayload(row.payload);
  let nextStage = rule[0];
  let detail = "";
  if (["PROVIDER_REQUESTS_SUPPLEMENT", "BUYER_SUPPLEMENTS", "PROVIDER_DECLINES", "PROVIDER_ENDS_COMMUNICATION_FAILED", "BUYER_REQUESTS_REVISION"].includes(event.event)) detail = text(event.detail, "detail", 4, 500);
  if (event.event === "PROVIDER_REQUESTS_SUPPLEMENT") payload.public.supplementNote = detail;
  if (event.event === "BUYER_SUPPLEMENTS") {
    payload.public.requirement = `${payload.public.requirement}\n补充：${detail}`;
    payload.public.supplementNote = "";
  }
  if (event.event === "PROVIDER_DECLINES") {
    payload.public.supplementNote = detail;
    payload.public.declinePhase = "request";
  }
  if (event.event === "PROVIDER_ENDS_COMMUNICATION_FAILED") {
    payload.public.supplementNote = detail;
    payload.public.declinePhase = "communication";
  }
  if (event.event === "PROVIDER_LOCKS_QUOTE") {
    if (payload.public.priceEdited) fail("QUOTE_ALREADY_LOCKED", "quote was already changed");
    payload.public.items = normalizeQuoteItems(event.items, payload.public.items);
    payload.public.amountFen = payload.public.items.reduce((sum, item) => sum + item.finalPriceFen, 0);
    payload.public.priceEdited = true;
  }
  if (event.event === "PROVIDER_RECORDS_CONTACT" && !payload.public.contactFirstCopiedAt) payload.public.contactFirstCopiedAt = now;
  if (event.event === "PROVIDER_ENDS_COMMUNICATION") {
    if (typeof event.ndaRequired !== "boolean") fail("VALIDATION_ERROR", "ndaRequired is required");
    if (!payload.public.contactFirstCopiedAt) fail("CONTACT_NOT_ACCESSED", "provider must access contact before ending communication");
    payload.public.ndaRequired = event.ndaRequired;
    payload.public.communicationDone = true;
    payload.public.timePlaceConfirmed = true;
    payload.public.serviceScopeConfirmed = true;
    payload.public.amountConfirmed = true;
    payload.public.executable = true;
    nextStage = event.ndaRequired ? "NDA_BUYER_PENDING" : "BUYER_FINAL_CONFIRM";
  }
  if (event.event === "BUYER_SIGNS_NDA") payload.public.buyerNdaSigned = true;
  if (event.event === "PROVIDER_SIGNS_NDA") payload.public.providerNdaSigned = true;
  if (event.event === "BUYER_CONFIRMS_AGREEMENT") {
    if (payload.public.buyerAgreementConfirmedAt) fail("AGREEMENT_ALREADY_CONFIRMED", "agreement was already confirmed");
    payload.public.buyerAgreementConfirmedAt = now;
  }
  if (event.event === "BUYER_CONFIRMS_EXECUTION" && payload.public.paymentStatus !== "PAID") fail("PAYMENT_NOT_VERIFIED", "payment is not verified");
  if (event.event === "PROVIDER_UPDATES_PROGRESS") {
    if (!Number.isSafeInteger(event.progress) || event.progress < 0 || event.progress > 99) fail("PROGRESS_INVALID", "progress must be an integer from 0 to 99");
    if (event.progress === Number(payload.public.progress || 0)) fail("PROGRESS_UNCHANGED", "progress did not change");
    payload.public.progress = event.progress;
  }
  if (event.event === "PROVIDER_SUBMITS_DELIVERY") {
    const deliveryNote = text(event.deliveryNote, "deliveryNote", 4, 1000);
    const deliveryHistory = Array.isArray(payload.public.deliveryHistory) ? payload.public.deliveryHistory : [];
    if (deliveryHistory.length >= 10) fail("DELIVERY_ROUND_LIMIT", "delivery round limit reached");
    const deliveryFiles = isOnsiteOrder(payload) ? [] : await normalizeDeliveryFiles(db, storage, event.deliveryFiles, row.id, actor.accountId);
    payload.public.deliveryNote = deliveryNote;
    payload.public.deliveryFiles = deliveryFiles;
    payload.public.deliveryHistory = deliveryHistory.concat([{ deliveryNote, deliveryFiles, createdAt: now }]);
    payload.public.progress = 100;
  }
  if (event.event === "BUYER_REQUESTS_REVISION") {
    payload.public.revisionNote = detail;
    payload.public.revisionCount = Number(payload.public.revisionCount || 0) + 1;
    payload.public.progress = Math.min(Number(payload.public.progress || 100), 99);
  }
  if (["BUYER_ACCEPTS_DELIVERY", "BUYER_ACCEPTS_AND_SETTLES"].includes(event.event)) {
    if (!String(payload.public.deliveryNote || "").trim()) fail("DELIVERY_INCOMPLETE", "delivery note is missing");
    if (!isOnsiteOrder(payload) && !(payload.public.deliveryFiles || []).length) fail("DELIVERY_INCOMPLETE", "delivery files are missing");
    payload.public.completedAt = now;
  }
  if (event.event === "BUYER_SUBMITS_REVIEW") {
    if (payload.public.rating) fail("REVIEW_ALREADY_SUBMITTED", "review was already submitted");
    if (!Number.isSafeInteger(event.rating) || event.rating < 1 || event.rating > 5) fail("REVIEW_RATING_INVALID", "review rating is invalid");
    payload.public.rating = event.rating;
    payload.public.reviewText = optionalText(event.reviewText, "reviewText", 200);
    payload.public.reviewedAt = now;
  }
  if (event.event === "PROVIDER_REPLIES_REVIEW") {
    if (!payload.public.rating) fail("REVIEW_NOT_FOUND", "review was not found");
    if (payload.public.reviewReply) fail("REVIEW_REPLY_ALREADY_SUBMITTED", "review reply was already submitted");
    payload.public.reviewReply = text(event.reviewReply, "reviewReply", 2, 200);
    payload.public.reviewRepliedAt = now;
  }
  payload.events.push({ id: `evt_${uuid().replace(/-/g, "")}`, event: event.event, actorId: actor.accountId, fromStage: row.stage, toStage: nextStage, detail, createdAt: now });
  const next = { payload: JSON.stringify(payload), stage: nextStage, version: row.version + 1, updated_at: now };
  const updated = rows(await db.from("order_aggregates").update(next).eq("id", row.id).eq("version", row.version).select("id"), "update order");
  if (!updated.length) fail("VERSION_CONFLICT", "order version changed");
  return publicOrder({ ...row, ...next }, keyValue, actor.accountId);
}

async function handleOrder(db, event = {}, context = {}, keyValue, now = Date.now(), uuid = crypto.randomUUID, storage) {
  if (event.action === "createOrder") return createOrder(db, event, context, keyValue, now, uuid);
  if (event.action === "transitionOrder") return transition(db, event, context, keyValue, now, uuid, storage);
  const actor = await resolveActor(db, context);
  if (event.action === "getOrder") {
    const { row } = await readOrder(db, event.orderId, actor.accountId);
    return publicOrder(row, keyValue, actor.accountId);
  }
  if (event.action === "listOrders") {
    const [buyer, provider] = await Promise.all([
      db.from("order_aggregates").select("*").eq("buyer_id", actor.accountId),
      db.from("order_aggregates").select("*").eq("provider_id", actor.accountId)
    ]);
    const uniqueRows = [...new Map([...rows(buyer, "read buyer orders"), ...rows(provider, "read provider orders")].map((row) => [row.id, row])).values()];
    return { orders: uniqueRows.sort((a, b) => b.updated_at - a.updated_at).map((row) => publicOrder(row, keyValue, actor.accountId)) };
  }
  fail("INVALID_ACTION", "action is not supported");
}

module.exports = { decryptContact, encryptContact, handleOrder, requestHash };
