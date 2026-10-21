const crypto = require("node:crypto");

const EXECUTION_STAGES = new Set(["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"]);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function rows(result, operation) { if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`); return result && result.data || []; }
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
function parse(value) { return typeof value === "string" ? JSON.parse(value) : value; }
function dbVersion(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail("DATABASE_OPERATION_FAILED", "project version is invalid");
  return normalized;
}
function dbTime(value, field) {
  const normalized = Number(value);
  if (value == null || value === "" || typeof value === "boolean" || !Number.isSafeInteger(normalized) || normalized < 0) fail("DATABASE_OPERATION_FAILED", `${field} is invalid`);
  return normalized;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function canonicalCityCode(value) {
  if (!/^\d{6}$/.test(value)) return "";
  return new Set(["11", "12", "31", "50", "71", "81", "82"]).has(value.slice(0, 2))
    ? `${value.slice(0, 2)}0000`
    : `${value.slice(0, 4)}00`;
}

async function resolveBuyer(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted identity is missing");
  const identity = rows(await db.from("wechat_identities").select("account_id").eq("open_id", openId), "read identity")[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  const account = rows(await db.from("accounts").select("id").eq("id", identity.account_id).eq("status", "ACTIVE"), "read active account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account is not active");
  const roles = rows(await db.from("account_roles").select("role").eq("account_id", identity.account_id), "read roles");
  if (!roles.some((item) => item.role === "BUYER")) fail("BUYER_ROLE_REQUIRED", "buyer role is required");
  return identity.account_id;
}

function publicProject(row) {
  return { id: row.id, version: dbVersion(row.version), createdAt: dbTime(row.created_at, "project createdAt"), updatedAt: dbTime(row.updated_at, "project updatedAt"), ...parse(row.payload) };
}

async function readOwnedProject(db, projectId, buyerId) {
  const row = rows(await db.from("project_aggregates").select("*").eq("id", safeId(projectId, "projectId")).eq("buyer_id", buyerId), "read project")[0];
  if (!row) fail("PROJECT_NOT_FOUND", "project was not found");
  return { ...row, version: dbVersion(row.version) };
}

async function deriveDraft(db, buyerId) {
  const orders = rows(await db.from("order_aggregates").select("*").eq("buyer_id", buyerId), "read buyer orders")
    .filter((row) => row.stage !== "DECLINED").sort((a, b) => b.updated_at - a.updated_at);
  const latest = orders[0] && parse(orders[0].payload).public;
  if (!latest) return { title: "未命名项目", date: "", city: "", cityCode: "", location: "", description: "", sourceOrderIds: [] };
  const firstSegment = latest.timeSegments && latest.timeSegments[0];
  const date = firstSegment ? new Date(firstSegment.startsAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
  const services = (latest.items || []).map((item) => item.name).filter(Boolean).join("、");
  const description = [services && `服务内容：${services}`, latest.requirement && `需求说明：${latest.requirement}`].filter(Boolean).join("\n");
  return {
    title: "未命名项目", date, city: latest.city || "", cityCode: latest.cityCode || "", location: latest.location || "",
    description, sourceOrderIds: orders.map((row) => row.id)
  };
}

async function createProject(db, event, buyerId, now, uuid) {
  const key = text(event.idempotencyKey, "idempotencyKey", 16, 128);
  const existing = rows(await db.from("project_aggregates").select("*").eq("buyer_id", buyerId).eq("create_idempotency_key", key), "read idempotent project")[0];
  if (existing) return publicProject(existing);
  const draft = await deriveDraft(db, buyerId);
  const row = {
    id: `prj_${uuid().replace(/-/g, "")}`, buyer_id: buyerId, create_idempotency_key: key,
    payload: JSON.stringify({ ...draft, targetImages: [], bookingIds: [], briefSaved: false }),
    version: 1, created_at: now, updated_at: now
  };
  rows(await db.from("project_aggregates").insert(row), "create project");
  return publicProject(row);
}

async function normalizeTargetImages(db, value, buyerId) {
  if (!Array.isArray(value) || value.length > 6) fail("VALIDATION_ERROR", "targetAssetIds is invalid");
  const ids = value.map((id, index) => safeId(id, `targetAssetIds[${index}]`));
  if (new Set(ids).size !== ids.length) fail("VALIDATION_ERROR", "targetAssetIds contains duplicates");
  if (!ids.length) return [];
  const assets = rows(await db.from("media_assets").select("id,storage_key,mime_type,size_bytes").in("id", ids)
    .eq("owner_account_id", buyerId).eq("purpose", "PROJECT_TARGET").eq("status", "READY"), "read project media");
  if (assets.length !== ids.length) fail("PROJECT_MEDIA_NOT_READY", "project media is not ready or owned by buyer");
  const byId = new Map(assets.map((item) => [item.id, item]));
  return ids.map((id) => ({ assetId: id, fileId: byId.get(id).storage_key, mimeType: byId.get(id).mime_type, sizeBytes: byId.get(id).size_bytes }));
}

async function saveProject(db, event, buyerId, now) {
  const row = await readOwnedProject(db, event.projectId, buyerId);
  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion !== row.version) fail("VERSION_CONFLICT", "project version changed");
  const input = event.project || {};
  const date = text(input.date, "date", 10, 10);
  if (!validDate(date)) fail("VALIDATION_ERROR", "date is invalid");
  const current = parse(row.payload);
  const cityCode = String(input.cityCode || "").trim();
  if (!/^\d{6}$/.test(cityCode) || cityCode !== canonicalCityCode(cityCode)) fail("VALIDATION_ERROR", "cityCode must identify a city");
  const payload = {
    ...current,
    title: text(input.title, "title", 1, 60), date,
    city: text(input.city, "city", 1, 60), cityCode, location: text(input.location, "location", 1, 120),
    description: text(input.description, "description", 1, 1000),
    targetImages: await normalizeTargetImages(db, input.targetAssetIds || [], buyerId), briefSaved: true
  };
  const next = { payload: JSON.stringify(payload), version: row.version + 1, updated_at: now };
  const updated = rows(await db.from("project_aggregates").update(next).eq("id", row.id).eq("buyer_id", buyerId).eq("version", row.version).select("id"), "save project");
  if (!updated.length) fail("VERSION_CONFLICT", "project version changed");
  return publicProject({ ...row, ...next });
}

async function linkOrder(db, event, buyerId, now, unlink = false) {
  const row = await readOwnedProject(db, event.projectId, buyerId);
  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion !== row.version) fail("VERSION_CONFLICT", "project version changed");
  const orderId = safeId(event.orderId, "orderId");
  const payload = parse(row.payload);
  const bookingIds = Array.isArray(payload.bookingIds) ? payload.bookingIds : [];
  if (unlink) {
    if (!bookingIds.includes(orderId)) fail("ORDER_NOT_LINKED", "order is not linked");
    payload.bookingIds = bookingIds.filter((id) => id !== orderId);
  } else {
    if (bookingIds.includes(orderId)) fail("ORDER_ALREADY_LINKED", "order is already linked");
    const order = rows(await db.from("order_aggregates").select("id,stage").eq("id", orderId).eq("buyer_id", buyerId), "read eligible order")[0];
    if (!order || !EXECUTION_STAGES.has(order.stage)) fail("ORDER_NOT_ELIGIBLE", "order cannot be linked");
    payload.bookingIds = bookingIds.concat(orderId);
  }
  const next = { payload: JSON.stringify(payload), version: row.version + 1, updated_at: now };
  const updated = rows(await db.from("project_aggregates").update(next).eq("id", row.id).eq("buyer_id", buyerId).eq("version", row.version).select("id"), "update project orders");
  if (!updated.length) fail("VERSION_CONFLICT", "project version changed");
  return publicProject({ ...row, ...next });
}

async function getTargetImages(db, storage, event, buyerId) {
  await readOwnedProject(db, event.projectId, buyerId);
  if (!Array.isArray(event.assetIds) || event.assetIds.length > 6) fail("VALIDATION_ERROR", "assetIds is invalid");
  const ids = event.assetIds.map(id => safeId(id, "assetId"));
  if (new Set(ids).size !== ids.length) fail("VALIDATION_ERROR", "assetIds contains duplicates");
  if (!ids.length) return { images: [] };
  // Owned, not-yet-saved target images must also be previewable in the editor.
  const assets = rows(await db.from("media_assets").select("id,storage_key,mime_type")
    .in("id", ids).eq("owner_account_id", buyerId).eq("purpose", "PROJECT_TARGET").eq("status", "READY"), "read target images")
    .filter(asset => ["image/jpeg", "image/png", "image/webp"].includes(asset.mime_type)
      && String(asset.storage_key || "").startsWith("cloud://"));
  if (!assets.length) return { images: ids.map(assetId => ({ assetId, url: null })) };
  const result = await storage.getTempFileURL({ fileList: assets.map(asset => ({ fileID: asset.storage_key, maxAge: 300 })) });
  const files = result && Array.isArray(result.fileList) ? result.fileList : [];
  return { images: ids.map(assetId => {
    const asset = assets.find(item => item.id === assetId);
    const file = asset && files.find(item => item && item.fileID === asset.storage_key);
    let url = null;
    if (file && (!file.code || file.code === "SUCCESS")) {
      const candidate = file.tempFileURL || file.download_url;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) url = candidate;
      } catch (_) { /* Unavailable files keep their slot so the owner can remove them. */ }
    }
    return { assetId, url };
  }) };
}

async function handleProject(db, event = {}, context = {}, now = Date.now(), uuid = crypto.randomUUID, storage) {
  const buyerId = await resolveBuyer(db, context);
  if (event.action === "getTargetImages") return getTargetImages(db, storage, event, buyerId);
  if (event.action === "listProjects") {
    const projects = rows(await db.from("project_aggregates").select("*").eq("buyer_id", buyerId), "list projects");
    return { projects: projects.sort((a, b) => b.updated_at - a.updated_at).map(publicProject) };
  }
  if (event.action === "getProject") return publicProject(await readOwnedProject(db, event.projectId, buyerId));
  if (event.action === "createProject") return createProject(db, event, buyerId, now, uuid);
  if (event.action === "saveProject") return saveProject(db, event, buyerId, now);
  if (event.action === "linkOrder") return linkOrder(db, event, buyerId, now, false);
  if (event.action === "unlinkOrder") return linkOrder(db, event, buyerId, now, true);
  fail("INVALID_ACTION", "action is not supported");
}

module.exports = { EXECUTION_STAGES, handleProject };
