const crypto = require('node:crypto');
function fault(code) { throw Object.assign(new Error(code), { code }); }
// All task mutations lock account -> draft -> intent, matching the apply worker.
async function mutatePublication(pool, input, now = Date.now()) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.owner || '')) fault('INVALID_OWNER');
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.beginTransaction();
    const [[account]] = await connection.execute('SELECT * FROM accounts WHERE id=? FOR UPDATE', [input.owner]);
    const [[draft]] = await connection.execute('SELECT * FROM provider_catalog_drafts WHERE provider_id=? FOR UPDATE', [input.owner]);
    if (!account || account.status !== 'ACTIVE') fault('ACCOUNT_NOT_AVAILABLE');
    if (input.action === 'cancel') {
      const [[task]] = await connection.execute('SELECT * FROM content_intents WHERE id=? FOR UPDATE', [input.intentId]);
      if (!task || task.account_id !== input.owner || task.kind !== 'PUBLICATION') fault('INTENT_NOT_FOUND');
      if (['STAGED', 'PENDING'].includes(task.status)) {
        await connection.execute("UPDATE content_intents SET status='CANCELLED',result_code='',updated_at=? WHERE id=?", [now, task.id]);
        await connection.execute('UPDATE provider_catalog_drafts SET pending_content_intent_id=NULL WHERE provider_id=? AND pending_content_intent_id=?', [input.owner, task.id]);
      }
      await connection.commit();
      return { id: task.id, status: ['STAGED','PENDING'].includes(task.status) ? 'CANCELLED' : task.status };
    }
    if (input.action !== 'stage' || !/^[a-f0-9]{64}$/.test(input.requestKey || '')) fault('INVALID_REQUEST_KEY');
    const [[existing]] = await connection.execute('SELECT * FROM content_intents WHERE account_id=? AND kind=? AND request_key=? FOR UPDATE', [input.owner, 'PUBLICATION', input.requestKey]);
    if (existing) {
      if (Number(existing.expected_version) !== input.version) fault('IDEMPOTENCY_CONFLICT');
      await connection.commit();
      return { queued: ['STAGED','PENDING'].includes(existing.status), intentId: existing.id, status: existing.status, providerId: input.owner, draftVersion: input.version };
    }
    if (!draft || Number(draft.version) !== input.version) fault('VERSION_CONFLICT');
    const [[role]] = await connection.execute("SELECT role FROM account_roles WHERE account_id=? AND role='PROVIDER' FOR SHARE", [input.owner]);
    if (!role) fault('PROVIDER_ROLE_REQUIRED');
    const id = crypto.randomBytes(16).toString('hex');
    await connection.execute("INSERT INTO content_intents (id,account_id,kind,expected_version,payload,status,result_code,created_at,updated_at,request_key) VALUES (?,?,'PUBLICATION',?,?,'PENDING','',?,?,?)",
      [id, input.owner, input.version, JSON.stringify(input.payload), now, now, input.requestKey]);
    await connection.execute('UPDATE provider_catalog_drafts SET pending_content_intent_id=? WHERE provider_id=?', [id, input.owner]);
    await connection.commit();
    return { queued: true, intentId: id, providerId: input.owner, draftVersion: input.version };
  } catch (error) {
    try { await connection.rollback(); } catch (_) { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
module.exports = { mutatePublication };
