const LOCKED_STAGES = new Set(["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"]);

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
  const roles = rows(await db.from("account_roles").select("role").eq("account_id", identity.account_id), "read roles");
  if (!roles.some((item) => item.role === "PROVIDER")) fail("PROVIDER_ROLE_REQUIRED", "provider role is required");
  return identity.account_id;
}

async function lockedDates(db, providerId) {
  const orders = rows(await db.from("order_aggregates").select("stage,payload").eq("provider_id", providerId), "read provider orders");
  return [...new Set(orders.filter((row) => LOCKED_STAGES.has(row.stage)).flatMap((row) => {
    const payload = parse(row.payload);
    return ((payload && payload.public && payload.public.timeSegments) || []).map((segment) => chinaDate(segment.startsAt));
  }))].sort();
}

function publicAvailability(row, locks) {
  const payload = row ? parse(row.payload) : { openDates: [] };
  return { providerId: row && row.provider_id || null, version: row ? dbVersion(row.version) : 0, openDates: payload.openDates || [], lockedDates: locks };
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
  const openDates = normalizeDates(event.openDates, today);
  const locks = await lockedDates(db, providerId);
  const previous = new Set(row ? parse(row.payload).openDates || [] : []);
  const next = new Set(openDates);
  if (locks.some((date) => date >= today && previous.has(date) !== next.has(date))) fail("LOCKED_DATE_MUTATION", "locked dates cannot be changed");
  const values = { payload: JSON.stringify({ openDates }), version: version + 1, updated_at: now };
  if (!row) {
    rows(await db.from("provider_availability").insert({ provider_id: providerId, ...values, created_at: now }), "create availability");
  } else {
    const updated = rows(await db.from("provider_availability").update(values).eq("provider_id", providerId).eq("version", version).select("provider_id"), "save availability");
    if (!updated.length) fail("VERSION_CONFLICT", "availability version changed");
  }
  return { providerId, version: version + 1, openDates, lockedDates: locks };
}

async function handleAvailability(db, event = {}, context = {}, now = Date.now()) {
  if (event.action === "getPublic") {
    const providerId = safeId(event.providerId, "providerId");
    return { ...publicAvailability(await readRow(db, providerId), await lockedDates(db, providerId)), providerId };
  }
  const providerId = await resolveActor(db, context);
  if (event.action === "getMine") return { ...publicAvailability(await readRow(db, providerId), await lockedDates(db, providerId)), providerId };
  if (event.action === "saveMine") return saveMine(db, event, providerId, now);
  fail("INVALID_ACTION", "action is not supported");
}

module.exports = { LOCKED_STAGES, chinaDate, handleAvailability, normalizeDates };
