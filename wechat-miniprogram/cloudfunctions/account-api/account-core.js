const intents = require("./content-intents");
const { nicknameKey } = require('./account-names');
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function rows(result, operation) { if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`); return result && result.data || []; }
function dbVersion(value) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) fail("DATABASE_OPERATION_FAILED", "account version is invalid"); return result; }
function dbTime(value) { const result = Number(value); if (value == null || value === "" || typeof value === "boolean" || !Number.isSafeInteger(result) || result < 0) fail("DATABASE_OPERATION_FAILED", "account timestamp is invalid"); return result; }
function nicknameValue(value) {
  if (typeof value !== "string") fail("VALIDATION_ERROR", "nickname is invalid");
  const nickname = value.trim();
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" }) : null;
  const length = segmenter ? Array.from(segmenter.segment(nickname)).length : Array.from(nickname).length;
  if (!length || length > 12 || /[\u0000-\u001f\u007f\u200b\u202a-\u202e\u2066-\u2069\ufeff]/.test(nickname) || nickname.length > 144) fail("VALIDATION_ERROR", "nickname is invalid");
  return nickname;
}
function avatarId(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^asset_[a-f0-9]{32}$/.test(value)) fail("VALIDATION_ERROR", "avatarAssetId is invalid");
  return value;
}
function regionText(value, field) {
  if (value == null) return "";
  if (typeof value !== "string") fail("VALIDATION_ERROR", `${field} is invalid`);
  const normalized = value.trim();
  if (normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) fail("VALIDATION_ERROR", `${field} is invalid`);
  return normalized;
}
function canonicalCityCode(value) {
  if (!/^\d{6}$/.test(value)) return "";
  return new Set(["11", "12", "31", "50", "71", "81", "82"]).has(value.slice(0, 2))
    ? `${value.slice(0, 2)}0000`
    : `${value.slice(0, 4)}00`;
}
function regionValue(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("VALIDATION_ERROR", "region is invalid");
  const cityCode = String(value.cityCode || "").trim();
  if (!/^\d{6}$/.test(cityCode) || cityCode !== canonicalCityCode(cityCode)) fail("VALIDATION_ERROR", "cityCode must identify a city");
  const cityName = regionText(value.cityName, "cityName");
  if (!cityName) fail("VALIDATION_ERROR", "cityName is required");
  if (!new Set(["LOCATED", "MANUAL", "PROJECT"]).has(source)) fail("VALIDATION_ERROR", "region source is invalid");
  return { provinceName: regionText(value.provinceName, "provinceName"), cityName, districtName: regionText(value.districtName, "districtName"), cityCode, source };
}
async function accountId(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted identity is missing");
  const identity = rows(await db.from("wechat_identities").select("account_id").eq("open_id", openId), "read identity")[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  return identity.account_id;
}
async function readAccount(db, id) {
  const account = rows(await db.from("accounts").select("id,uid,nickname,username,avatar_asset_id,status,version,updated_at" + (intents.enabled() ? ",pending_content_intent_id" : "")).eq("id", id).eq("status", "ACTIVE"), "read account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account was not found");
  return { ...account, version: dbVersion(account.version), updated_at: dbTime(account.updated_at) };
}
async function publicAccount(db, account) {
  let avatarFileId = null;
  if (account.avatar_asset_id) {
    const asset = rows(await db.from("media_assets").select("storage_key").eq("id", account.avatar_asset_id).eq("owner_account_id", account.id).eq("purpose", "AVATAR").eq("status", "READY"), "read avatar")[0];
    avatarFileId = asset && asset.storage_key || null;
  }
  return { ...(intents.enabled() ? { deferredAvatar: true, contentIntent: await intents.status(db, account.id, account.pending_content_intent_id) } : {}), id: account.id, uid: account.uid, nickname: account.nickname, username: account.username || "", avatarAssetId: account.avatar_asset_id || null, avatarFileId, version: account.version, updatedAt: account.updated_at };
}
async function updateMine(db, event, id, now, dependencies, context) {
  const account = await readAccount(db, id);
  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion !== account.version) fail("VERSION_CONFLICT", "account version changed");
  const nickname = nicknameValue(event.nickname);
  const nextAvatarId = avatarId(event.avatarAssetId);
  let pendingAvatar = false;
  if (nextAvatarId) {
    const asset = rows(await db.from("media_assets").select("id,status").eq("id", nextAvatarId).eq("owner_account_id", id).eq("purpose", "AVATAR"), "read new avatar")[0];
    pendingAvatar = Boolean(intents.enabled() && event.allowDeferred === true && asset?.status === "PENDING");
    if (!asset || (asset.status !== "READY" && !pendingAvatar)) fail("AVATAR_NOT_READY", "avatar is not ready or owned by account");
  }
  const next = { nickname, nickname_key: nicknameKey(nickname), avatar_asset_id: nextAvatarId, version: account.version + 1, updated_at: now };
  const checkNickname = async () => {
    const matches = rows(await db.from('accounts').select('id').eq('nickname_key', next.nickname_key), 'check nickname');
    if (matches.some(row => row.id !== id)) fail('NICKNAME_TAKEN', 'nickname already in use');
  };
  await checkNickname();
  if (nickname !== account.nickname) {
    if (typeof dependencies.reviewNickname !== "function") fail("NICKNAME_CHECK_UNAVAILABLE", "nickname reviewer is unavailable");
    await dependencies.reviewNickname(nickname, context.WX_OPENID || context.OPENID);
  }
  let intentId = null;
  if (intents.enabled()) {
    next.pending_content_intent_id = null;
    if (pendingAvatar) {
      intentId = await intents.stage(db, id, "AVATAR", next.version, { assets: [{ id: nextAvatarId, purpose: "AVATAR" }] }, now);
      next.avatar_asset_id = account.avatar_asset_id;
      next.pending_content_intent_id = intentId;
    }
  }
  const result = await db.from("accounts").update(next).eq("id", id).eq("version", account.version).select("id");
  if (result?.error) await checkNickname();
  const updated = rows(result, "update account");
  if (!updated.length) fail("VERSION_CONFLICT", "account version changed");
  if (intentId) await intents.activate(db, intentId, now).catch(() => null);
  return publicAccount(db, { ...account, ...next });
}
function publicPreference(row) {
  if (!row) return null;
  return {
    provinceName: row.province_name || "", cityName: row.city_name, districtName: row.district_name || "",
    cityCode: row.city_code, source: row.source, locatedAt: row.located_at == null ? null : dbTime(row.located_at),
    version: dbVersion(row.version), updatedAt: dbTime(row.updated_at)
  };
}
async function readPreference(db, id) {
  const row = rows(await db.from("account_discovery_preferences").select("province_name,city_name,district_name,city_code,source,located_at,version,updated_at").eq("account_id", id), "read discovery preference")[0];
  return publicPreference(row);
}
async function savePreference(db, id, event, now, current) {
  if (current === undefined) current = await readPreference(db, id);
  const expectedVersion = Number(event.expectedVersion || 0);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion !== (current ? current.version : 0)) fail("VERSION_CONFLICT", "discovery preference version changed");
  const region = regionValue(event.region, event.source);
  const next = {
    province_name: region.provinceName, city_name: region.cityName, district_name: region.districtName,
    city_code: region.cityCode, source: region.source, located_at: region.source === "LOCATED" ? now : null,
    version: expectedVersion + 1, updated_at: now
  };
  if (!current) {
    rows(await db.from("account_discovery_preferences").insert({ account_id: id, ...next, created_at: now }), "create discovery preference");
  } else {
    const updated = rows(await db.from("account_discovery_preferences").update(next).eq("account_id", id).eq("version", current.version).select("account_id"), "update discovery preference");
    if (!updated.length) fail("VERSION_CONFLICT", "discovery preference version changed");
  }
  return publicPreference({ ...next });
}
async function handleAccount(db, event = {}, context = {}, now = Date.now(), dependencies = {}) {
  const id = await accountId(db, context);
  if (event.action === "getMine") return publicAccount(db, await readAccount(db, id));
  if (event.action === "updateMine") return updateMine(db, event, id, now, dependencies, context);
  if (event.action === "getDiscoveryPreference") return { preference: await readPreference(db, id) };
  if (event.action === "saveDiscoveryPreference") return { preference: await savePreference(db, id, event, now) };
  if (event.action === "resolveDiscoveryLocation") {
    const latitude = Number(event.latitude); const longitude = Number(event.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) fail("VALIDATION_ERROR", "location is invalid");
    if (typeof dependencies.resolveRegion !== "function") fail("LOCATION_SERVICE_NOT_CONFIGURED", "location resolver is unavailable");
    const [resolved, current] = await Promise.all([
      dependencies.resolveRegion(latitude, longitude), readPreference(db, id)
    ]);
    const region = regionValue(resolved, "LOCATED");
    return { preference: await savePreference(db, id, { expectedVersion: event.expectedVersion, region, source: "LOCATED" }, now, current) };
  }
  fail("INVALID_ACTION", "action is not supported");
}

module.exports = { handleAccount, publicPreference, regionValue };
