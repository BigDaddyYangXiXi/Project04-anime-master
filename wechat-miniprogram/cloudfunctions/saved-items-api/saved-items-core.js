function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function rows(result, operation) { if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`); return result && result.data || []; }
function safeId(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail("VALIDATION_ERROR", "targetId is invalid"); return value; }
function targetType(value) { const normalized = String(value || "").toUpperCase(); if (!new Set(["PROVIDER", "WORK"]).has(normalized)) fail("VALIDATION_ERROR", "targetType is invalid"); return normalized; }
function parse(value) { return typeof value === "string" ? JSON.parse(value) : value; }
async function accountId(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted identity is missing");
  const identity = rows(await db.from("wechat_identities").select("account_id").eq("open_id", openId), "read identity")[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  return identity.account_id;
}
async function requirePublicTarget(db, type, id) {
  if (type === "PROVIDER") {
    const publication = rows(await db.from("provider_catalog_publications").select("provider_id").eq("provider_id", id), "read provider target")[0];
    if (!publication) fail("TARGET_NOT_PUBLIC", "provider is not public");
    return;
  }
  const publications = rows(await db.from("provider_catalog_publications").select("payload"), "read work targets");
  if (!publications.some((item) => ((parse(item.payload) || {}).works || []).some((work) => work.id === id))) fail("TARGET_NOT_PUBLIC", "work is not public");
}
async function receivedCounts(db, id) {
  const publication = rows(await db.from("provider_catalog_publications").select("payload").eq("provider_id", id), "read own publication")[0];
  const workIds = publication ? ((parse(publication.payload) || {}).works || []).map((work) => work.id).filter(Boolean) : [];
  const providerRows = rows(await db.from("account_saved_items").select("target_id").eq("target_type", "PROVIDER").eq("target_id", id).eq("saved", 1), "count received follows");
  const workRows = workIds.length
    ? rows(await db.from("account_saved_items").select("target_id").eq("target_type", "WORK").in("target_id", workIds).eq("saved", 1), "count received work likes")
    : [];
  return { receivedProviderFollows: providerRows.length, receivedWorkLikes: workRows.length };
}
async function handleSavedItems(db, event = {}, context = {}, now = Date.now()) {
  const id = await accountId(db, context);
  if (event.action === "listMine") {
    const items = rows(await db.from("account_saved_items").select("target_type,target_id,updated_at").eq("account_id", id).eq("saved", 1), "list saved items");
    const received = await receivedCounts(db, id);
    return {
      providerIds: items.filter((item) => item.target_type === "PROVIDER").sort((a, b) => b.updated_at - a.updated_at).map((item) => item.target_id),
      workIds: items.filter((item) => item.target_type === "WORK").sort((a, b) => b.updated_at - a.updated_at).map((item) => item.target_id),
      ...received
    };
  }
  if (event.action === "setSaved") {
    const type = targetType(event.targetType); const targetId = safeId(event.targetId);
    if (typeof event.saved !== "boolean") fail("VALIDATION_ERROR", "saved is invalid");
    if (event.saved) await requirePublicTarget(db, type, targetId);
    const existing = rows(await db.from("account_saved_items").select("created_at").eq("account_id", id).eq("target_type", type).eq("target_id", targetId), "read saved item")[0];
    rows(await db.from("account_saved_items").upsert({ account_id: id, target_type: type, target_id: targetId, saved: event.saved ? 1 : 0, created_at: existing && existing.created_at || now, updated_at: now }), "save item");
    return { targetType: type, targetId, saved: event.saved };
  }
  fail("INVALID_ACTION", "action is not supported");
}
module.exports = { handleSavedItems };
