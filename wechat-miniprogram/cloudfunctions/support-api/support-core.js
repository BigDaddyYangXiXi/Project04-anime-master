const crypto = require('node:crypto');
function fail(code) { const e = new Error(code); e.code = code; throw e; }
function rows(result) { if (result?.error) fail('DATABASE_OPERATION_FAILED'); return result?.data || []; }
function text(value, min, max) { if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('VALIDATION_ERROR'); return value.trim(); }
function id(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) fail('VALIDATION_ERROR'); return value; }
async function owner(db, context) {
  const openId = context?.WX_OPENID || context?.OPENID;
  if (!openId) fail('AUTH_CONTEXT_MISSING');
  const identity = rows(await db.from('wechat_identities').select('account_id').eq('open_id', openId))[0];
  if (!identity || !rows(await db.from('accounts').select('id').eq('id', identity.account_id).eq('status', 'ACTIVE')).length) fail('ACCOUNT_NOT_FOUND');
  return identity.account_id;
}
function attachmentIds(ids) {
  if (!Array.isArray(ids) || ids.length > 3 || ids.some(id => typeof id !== 'string' || !/^asset_[a-f0-9]{32}$/.test(id)) || new Set(ids).size !== ids.length) fail('VALIDATION_ERROR');
  return ids;
}
async function attachments(db, ids, account) {
  if (!ids.length) return [];
  const media = rows(await db.from('media_assets').select('id,storage_key,mime_type,size_bytes,committed_at').in('id', ids).eq('owner_account_id', account).eq('purpose', 'SUPPORT_IMAGE').eq('status', 'READY'));
  if (media.length !== ids.length || media.some(a => !a.committed_at || !String(a.storage_key).startsWith('cloud://') || !['image/jpeg','image/png','image/webp'].includes(a.mime_type) || !Number.isSafeInteger(Number(a.size_bytes)) || Number(a.size_bytes) <= 0 || Number(a.size_bytes) > 10 * 1024 * 1024)) fail('ATTACHMENT_NOT_READY');
  return ids.map(id => ({ assetId: id, fileId: media.find(a => a.id === id).storage_key }));
}
function payloadOf(row) { return typeof row.payload === 'string' ? JSON.parse(row.payload) : structuredClone(row.payload); }
function view(row) {
  const payload = payloadOf(row);
  return { id: row.id, kind: row.kind, status: row.status, version: Number(row.version), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), description: payload.description, guide: payload.guide, orderId: payload.orderId, attachments: payload.attachments || [], events: payload.events.map(({ id, actor, text, time, status }) => ({ id, actor, text, time, ...(status ? { status } : {}) })) };
}
async function read(db, requestId, account) {
  const row = rows(await db.from('support_requests').select('*').eq('id', id(requestId)).eq('account_id', account))[0];
  if (!row) fail('REQUEST_NOT_FOUND');
  return row;
}
async function update(db, row, patch) {
  const changed = rows(await db.from('support_requests').update(patch).eq('id', row.id).eq('account_id', row.account_id).eq('version', row.version).select('id'));
  if (!changed.length) fail('VERSION_CONFLICT');
  return view({ ...row, ...patch });
}
async function handleSupport(db, event, context, now = Date.now()) {
  const account = await owner(db, context);
  if (event.action === 'create') {
    const kind = ['FEEDBACK', 'PHONE', 'PRIVACY', 'CANCEL'].includes(event.kind) ? event.kind : fail('VALIDATION_ERROR');
    const key = id(event.idempotencyKey), description = text(event.description, 10, 1000), guide = text(event.guide || '', 0, 40), orderId = event.orderId ? id(event.orderId) : '';
    const assetIds = attachmentIds(event.assetIds || []);
    const requestId = 'sup_' + crypto.createHash('sha256').update(account + ':' + key).digest('hex').slice(0, 32);
    const previous = rows(await db.from('support_requests').select('*').eq('id', requestId).eq('account_id', account))[0];
    const digest = crypto.createHash('sha256').update(JSON.stringify({ kind, description, guide, orderId, assetIds })).digest('hex');
    if (previous) { if (previous.input_hash !== digest) fail('IDEMPOTENCY_CONFLICT'); return view(previous); }
    if (orderId) {
      const order = rows(await db.from('order_aggregates').select('buyer_id,provider_id').eq('id', orderId))[0];
      if (!order || ![order.buyer_id, order.provider_id].includes(account)) fail('ORDER_NOT_OWNED');
    }
    const images = await attachments(db, assetIds, account);
    const payload = { description, guide, orderId, attachments: images, events: [{ id: key, actor: 'USER', text: description, time: now }] };
    const row = { id: requestId, account_id: account, kind, status: 'PENDING', version: 1, input_hash: digest, payload: JSON.stringify(payload), created_at: now, updated_at: now };
    const inserted = await db.from('support_requests').insert(row);
    if (inserted?.error) {
      const raced = rows(await db.from('support_requests').select('*').eq('id', requestId).eq('account_id', account))[0];
      if (!raced || raced.input_hash !== digest) fail('DATABASE_OPERATION_FAILED');
      return view(raced);
    }
    return view(row);
  }
  if (event.action === 'list') {
    const query = () => db.from('support_requests').select('*').eq('account_id', account).order('created_at', { ascending: false }).order('id', { ascending: false });
    let found;
    if (event.cursor) {
      const c = event.cursor;
      if (!Number.isSafeInteger(c.time) || c.time < 0) fail('VALIDATION_ERROR'); id(c.id);
      found = rows(await query().eq('created_at', c.time).lt('id', c.id).limit(21));
      if (found.length < 21) found.push(...rows(await query().lt('created_at', c.time).limit(21 - found.length)));
    } else found = rows(await query().limit(21));
    const items = found.slice(0, 20).map(view), last = items.at(-1);
    return { items, cursor: found.length > 20 ? { time: last.createdAt, id: last.id } : null };
  }
  const row = await read(db, event.id, account);
  if (event.action === 'get') return view(row);
  if (!['append', 'withdraw'].includes(event.action)) fail('INVALID_ACTION');
  const payload = payloadOf(row), key = id(event.idempotencyKey);
  const previous = payload.events.find(e => e.id === key);
  const description = event.action === 'withdraw' ? '已撤回注销申请。' : text(event.description, 1, 1000);
  if (previous) { if (previous.actor !== 'USER' || previous.action !== event.action || previous.text !== description) fail('IDEMPOTENCY_CONFLICT'); return view(row); }
  if (Number(row.version) !== event.expectedVersion) fail('VERSION_CONFLICT');
  if (['CLOSED', 'WITHDRAWN'].includes(row.status)) fail('REQUEST_CLOSED');
  if (payload.events.length >= 50) fail('REQUEST_LIMIT');
  if (event.action === 'withdraw' && row.kind !== 'CANCEL') fail('VALIDATION_ERROR');
  payload.events.push({ id: key, actor: 'USER', action: event.action, text: description, time: now });
  return update(db, row, { payload: JSON.stringify(payload), status: event.action === 'withdraw' ? 'WITHDRAWN' : row.status === 'REPLIED' ? 'PROCESSING' : row.status, version: Number(row.version) + 1, updated_at: now });
}
// Operator entry is intentionally separate from the public cloud handler.
// This only records progress; it never changes phone bindings or deletes accounts.
async function recordReply(db, input, now = Date.now()) {
  const row = await read(db, input.id, id(input.accountId));
  const patch = replyPatch(row, input, now);
  return patch ? update(db, row, patch) : view(row);
}
function replyPatch(row, input, now = Date.now()) {
  if (row.id !== id(input.id) || row.account_id !== id(input.accountId)) fail('REQUEST_NOT_FOUND');
  const payload = payloadOf(row), key = id(input.idempotencyKey), reply = text(input.reply, 1, 1000), operatorId = id(input.operatorId);
  if (!['PROCESSING', 'REPLIED', 'CLOSED'].includes(input.status)) fail('VALIDATION_ERROR');
  const previous = payload.events.find(e => e.id === key);
  if (previous) { if (previous.actor !== 'SUPPORT' || previous.text !== reply || previous.status !== input.status || previous.operatorId !== operatorId) fail('IDEMPOTENCY_CONFLICT'); return null; }
  if (Number(row.version) !== input.expectedVersion) fail('VERSION_CONFLICT');
  if (['CLOSED', 'WITHDRAWN'].includes(row.status)) fail('REQUEST_CLOSED');
  if (payload.events.length >= 50) fail('REQUEST_LIMIT');
  payload.events.push({ id: key, actor: 'SUPPORT', operatorId, text: reply, status: input.status, time: now });
  return { payload: JSON.stringify(payload), status: input.status, version: Number(row.version) + 1, updated_at: now };
}
module.exports = { handleSupport, recordReply, replyPatch };
