const LOCKED_STAGES = new Set(["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING", "COMPLETED"]);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function rows(result, operation) { if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`); return result && result.data || []; }
function safeId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail("VALIDATION_ERROR", `${field} is invalid`);
  return value;
}
function parse(value) { return typeof value === "string" ? JSON.parse(value) : value; }
function dbVersion(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail("DATABASE_OPERATION_FAILED", "availability version is invalid");
  return normalized;
}
function chinaDate(timestamp) { return new Date(Number(timestamp) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function occupiedDates(segment) {
  const start = Number(segment.startsAt);
  const last = chinaDate(Math.max(start, Number(segment.endsAt == null ? start : segment.endsAt) - 1));
  const cursor = new Date(`${chinaDate(start)}T00:00:00Z`);
  const dates = [];
  for (let date = cursor.toISOString().slice(0, 10); date <= last; cursor.setUTCDate(cursor.getUTCDate() + 1), date = cursor.toISOString().slice(0, 10)) dates.push(date);
  return dates;
}
function normalizeDates(value, today) {
  if (!Array.isArray(value) || value.length > 366) fail("VALIDATION_ERROR", "openDates is invalid");
  const latest = new Date(`${today}T00:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 366);
  const latestDate = latest.toISOString().slice(0, 10);
  const dates = value.map((item) => {
    const parsed = typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item) ? new Date(`${item}T00:00:00Z`) : null;
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== item || item < today || item > latestDate) {
      fail("VALIDATION_ERROR", "openDates contains an invalid date");
    }
    return item;
  });
  if (new Set(dates).size !== dates.length) fail("VALIDATION_ERROR", "openDates contains duplicates");
  return dates.sort();
}

async function resolveActor(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted identity is missing");
  const identity = rows(await db.from("wechat_identities").select("account_id").eq("open_id", openId), "read identity")[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  const account = rows(await db.from("accounts").select("id").eq("id", identity.account_id).eq("status", "ACTIVE"), "read active account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account is not active");
  const roles = rows(await db.from("account_roles").select("role").eq("account_id", identity.account_id), "read roles");
  if (!roles.some((item) => item.role === "PROVIDER")) fail("PROVIDER_ROLE_REQUIRED", "provider role is required");
  return identity.account_id;
}

async function lockedDates(db, providerId) {
  const orders = rows(await db.from("order_aggregates").select("stage,payload").eq("provider_id", providerId), "read provider orders");
  return [...new Set(orders.filter((row) => LOCKED_STAGES.has(row.stage)).flatMap((row) => {
    const payload = parse(row.payload);
    if (["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(row.stage) && payload.public.ndaFlowVersion === 2
      && payload.public.communicationDone === false) return [];
    return ((payload && payload.public && payload.public.timeSegments) || []).flatMap(occupiedDates);
  }))].sort();
}

async function requirePublicProvider(db, providerId) {
  const account = rows(await db.from("accounts").select("id").eq("id", providerId).eq("status", "ACTIVE"), "read public account")[0];
  if (!account) fail("TARGET_NOT_PUBLIC", "provider is not public");
  const publication = rows(await db.from("provider_catalog_publications").select("payload").eq("provider_id", providerId), "read public snapshot")[0];
  if (publication) {
    let payload;
    try { payload = parse(publication.payload); } catch { /* A damaged snapshot must not expose legacy data. */ }
    if (!payload || !payload.profile || !Array.isArray(payload.services) || !Array.isArray(payload.works)) {
      fail("TARGET_NOT_PUBLIC", "provider is not public");
    }
    return;
  }
  const profile = rows(await db.from("provider_profiles").select("provider_id").eq("provider_id", providerId).eq("publish_status", "PUBLISHED"), "read legacy public profile")[0];
  if (!profile) fail("TARGET_NOT_PUBLIC", "provider is not public");
}

function publicAvailability(row, locks) {
  const payload = row ? parse(row.payload) : { openDates: [] };
  return { providerId: row && row.provider_id || null, version: row ? dbVersion(row.version) : 0, openDates: payload.openDates || [], accepting: typeof payload.accepting === "boolean" ? payload.accepting : null, lockedDates: locks };
}

async function readRow(db, providerId) {
  const row = rows(await db.from("provider_availability").select("*").eq("provider_id", providerId), "read availability")[0];
  return row ? { ...row, version: dbVersion(row.version) } : null;
}

async function saveMine(db, event, providerId, now) {
  const row = await readRow(db, providerId);
  const version = row ? row.version : 0;
  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion !== version) fail("VERSION_CONFLICT", "availability version changed");
  const today = chinaDate(now);
  if (event.accepting != null && typeof event.accepting !== "boolean") fail("VALIDATION_ERROR", "accepting must be boolean");
  const oldPayload = row ? parse(row.payload) : {};
  const openDates = event.openDates == null ? (oldPayload.openDates || []) : normalizeDates(event.openDates, today);
  const locks = await lockedDates(db, providerId);
  const previous = new Set(row ? parse(row.payload).openDates || [] : []);
  const next = new Set(openDates);
  if (locks.some((date) => date >= today && previous.has(date) !== next.has(date))) fail("LOCKED_DATE_MUTATION", "locked dates cannot be changed");
  const values = { payload: JSON.stringify({ ...oldPayload, openDates, ...(event.accepting == null ? {} : { accepting: event.accepting }) }), version: version + 1, updated_at: now };
  if (!row) {
    rows(await db.from("provider_availability").insert({ provider_id: providerId, ...values, created_at: now }), "create availability");
  } else {
    const updated = rows(await db.from("provider_availability").update(values).eq("provider_id", providerId).eq("version", version).select("provider_id"), "save availability");
    if (!updated.length) fail("VERSION_CONFLICT", "availability version changed");
  }
  return { providerId, version: version + 1, openDates, accepting: event.accepting ?? oldPayload.accepting ?? null, lockedDates: locks };
}

async function readAvailability(db, providerId) {
  const [row, locks] = await Promise.all([readRow(db, providerId), lockedDates(db, providerId)]);
  return { ...publicAvailability(row, locks), providerId };
}

async function handleAvailability(db, event = {}, context = {}, now = Date.now()) {
  if (event.action === "getPublic") {
    const providerId = safeId(event.providerId, "providerId");
    await requirePublicProvider(db, providerId);
    return readAvailability(db, providerId);
  }
  const providerId = await resolveActor(db, context);
  if (event.action === "getMine") return readAvailability(db, providerId);
  if (event.action === "saveMine") return saveMine(db, event, providerId, now);
  fail("INVALID_ACTION", "action is not supported");
}

module.exports = { LOCKED_STAGES, chinaDate, handleAvailability, normalizeDates };
