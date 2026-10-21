function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function rows(result, operation) { if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`); return result && result.data || []; }
function safeId(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail("VALIDATION_ERROR", "targetId is invalid"); return value; }
function targetType(value) { const normalized = String(value || "").toUpperCase(); if (!new Set(["PROVIDER", "WORK"]).has(normalized)) fail("VALIDATION_ERROR", "targetType is invalid"); return normalized; }
function parse(value) { return typeof value === "string" ? JSON.parse(value) : value; }
function publicationWorks(row) {
  try {
    const payload = row && parse(row.payload);
    return payload && payload.profile && Array.isArray(payload.services) && Array.isArray(payload.works) ? payload.works : null;
  } catch { return null; }
}
async function requireActiveAuthor(db, id) {
  const account = rows(await db.from("accounts").select("id").eq("id", id).eq("status", "ACTIVE"), "read public author")[0];
  if (!account) fail("TARGET_NOT_PUBLIC", "author is not public");
}
async function requireLegacyProfile(db, id) {
  const profile = rows(await db.from("provider_profiles").select("provider_id").eq("provider_id", id).eq("publish_status", "PUBLISHED"), "read legacy provider target")[0];
  if (!profile) fail("TARGET_NOT_PUBLIC", "provider is not public");
}
async function accountId(db, context) {
  const openId = context && (context.WX_OPENID || context.OPENID);
  if (!openId) fail("AUTH_CONTEXT_MISSING", "trusted identity is missing");
  const identity = rows(await db.from("wechat_identities").select("account_id").eq("open_id", openId), "read identity")[0];
  if (!identity) fail("ACCOUNT_NOT_FOUND", "account is not initialized");
  const account = rows(await db.from("accounts").select("id").eq("id", identity.account_id).eq("status", "ACTIVE"), "read active account")[0];
  if (!account) fail("ACCOUNT_NOT_FOUND", "account is not active");
  return identity.account_id;
}
async function requirePublicTarget(db, type, id) {
  if (type === "PROVIDER") {
    const publication = rows(await db.from("provider_catalog_publications").select("provider_id,payload").eq("provider_id", id), "read provider target")[0];
    if (publication) {
      if (!publicationWorks(publication)) fail("TARGET_NOT_PUBLIC", "provider is not public");
    } else await requireLegacyProfile(db, id);
    await requireActiveAuthor(db, id);
    return;
  }
  const publications = []; let cursor = '';
  for (;;) {
    let query = db.from('provider_catalog_publications').select('provider_id,payload').order('provider_id', { ascending: true }).limit(20);
    if (cursor) query = query.gt('provider_id', cursor);
    const page = rows(await query, 'read work targets');
    publications.push(...page);
    if (page.length < 20) break;
    const next = page[page.length - 1].provider_id;
    if (!next || next === cursor) fail('DATABASE_OPERATION_FAILED', 'publication cursor did not advance');
    cursor = next;
  }
  const owners = new Set(publications.filter(item => (publicationWorks(item) || []).some(work => work && work.id === id)).map(item => item.provider_id));
  const legacyWorks = rows(await db.from("works").select("provider_id").eq("id", id).eq("status", "PUBLISHED"), "read legacy work target")
    .filter(work => !publications.some(item => item.provider_id === work.provider_id));
  if (legacyWorks.length) {
    const profiles = rows(await db.from("provider_profiles").select("provider_id").in("provider_id", legacyWorks.map(work => work.provider_id)).eq("publish_status", "PUBLISHED"), "read legacy work authors");
    profiles.forEach(profile => owners.add(profile.provider_id));
  }
  const active = owners.size ? rows(await db.from("accounts").select("id").in("id", [...owners]).eq("status", "ACTIVE"), "read public work authors") : [];
  if (active.length !== 1) fail("TARGET_NOT_PUBLIC", "work ownership is not uniquely public");
}
async function exactCount(query) {
  const result = await query;
  if (result?.error || !Number.isSafeInteger(result?.count) || result.count < 0) fail('DATABASE_OPERATION_FAILED', 'exact count unavailable');
  return result.count;
}
function receivedQuery(db, type) { return db.from('account_saved_items').select('target_id', { head: true, count: 'exact' }).eq('target_type', type).eq('saved', 1); }
async function ownSaved(db, account, type) {
  const items = []; let cursor = '';
  for (;;) {
    let query = db.from('account_saved_items').select('target_id,updated_at').eq('account_id', account).eq('target_type', type).eq('saved', 1).order('target_id', { ascending: true }).limit(20);
    if (cursor) query = query.gt('target_id', cursor);
    const page = rows(await query, 'list own saved items');
    items.push(...page);
    if (page.length < 20) break;
    const next = page[page.length - 1].target_id;
    if (!next || next === cursor) fail('DATABASE_OPERATION_FAILED', 'saved cursor did not advance');
    cursor = next;
  }
  return items.sort((a,b) => b.updated_at - a.updated_at).map(item => item.target_id);
}
async function receivedCounts(db, id) {
  const publication = rows(await db.from('provider_catalog_publications').select('payload').eq('provider_id', id), 'read own publication')[0];
  const workIds = [...new Set((publicationWorks(publication) || []).map(work => work && work.id).filter(Boolean))];
  const [receivedProviderFollows, receivedWorkLikes] = await Promise.all([
    exactCount(receivedQuery(db, 'PROVIDER').eq('target_id', id)),
    workIds.length ? exactCount(receivedQuery(db, 'WORK').in('target_id', workIds)) : 0
  ]);
  return { receivedProviderFollows, receivedWorkLikes };
}
async function handleSavedItems(db, event = {}, context = {}, now = Date.now()) {
  const id = await accountId(db, context);
  if (event.action === 'listReceived') {
    if (!['likes', 'followers'].includes(event.type)) fail('VALIDATION_ERROR', 'type invalid');
    const cursor = event.cursor == null ? 0 : event.cursor;
    if (event.type === 'likes' && (!Number.isSafeInteger(cursor) || cursor < 0)) fail('VALIDATION_ERROR', 'cursor invalid');
    let items;
    if (event.type === 'likes') {
      const publication = rows(await db.from('provider_catalog_publications').select('payload').eq('provider_id', id), 'own publication')[0];
      const works = publicationWorks(publication) || [];
      items = [];
      // Bound simultaneous count queries; never transfer every follower/like row.
      for (let offset = 0; offset < works.length; offset += 4) {
        items.push(...await Promise.all(works.slice(offset, offset + 4).map(async work => ({ id: work.id, title: work.title || work.name || '未命名作品', count: await exactCount(receivedQuery(db, 'WORK').eq('target_id', work.id)), providerId: id }))));
      }
      items = items.filter(w => w.count > 0).sort((a,b) => b.count - a.count || a.id.localeCompare(b.id));
    } else {
      const query = () => db.from('account_saved_items').select('account_id,updated_at').eq('target_type', 'PROVIDER').eq('target_id', id).eq('saved', 1).order('updated_at', { ascending: false }).order('account_id', { ascending: false });
      let ordered;
      if (event.cursor != null) {
        if (!Number.isSafeInteger(cursor.time) || cursor.time < 0) fail('VALIDATION_ERROR', 'cursor invalid'); safeId(cursor.id);
        ordered = rows(await query().eq('updated_at', cursor.time).lt('account_id', cursor.id).limit(21), 'received follows');
        if (ordered.length < 21) ordered.push(...rows(await query().lt('updated_at', cursor.time).limit(21 - ordered.length), 'received follows'));
      } else ordered = rows(await query().limit(21), 'received follows');
      const slice = ordered.slice(0, 20);
      const accounts = slice.length ? rows(await db.from('accounts').select('id,nickname,username,status').in('id', slice.map(f => f.account_id)), 'follower public names') : [];
      // No phone, external identity, or account/security data is returned.
      items = slice.map(f => { const a = accounts.find(a => a.id === f.account_id); return { id: f.account_id, nickname: a?.status === 'ACTIVE' ? a.nickname : '账号不可用', username: a?.status === 'ACTIVE' ? a.username : '' }; });
      const last = slice[slice.length - 1];
      return { items, cursor: ordered.length > 20 ? { time: Number(last.updated_at), id: last.account_id } : null };
    }
    return { items: items.slice(cursor, cursor + 20), cursor: items.length > cursor + 20 ? cursor + 20 : null };
  }
  if (event.action === "listMine") {
    const [providerIds, workIds, received] = await Promise.all([ownSaved(db, id, 'PROVIDER'), ownSaved(db, id, 'WORK'), receivedCounts(db, id)]);
    return { providerIds, workIds, ...received };
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
