const MAX_AGE = 24 * 60 * 60 * 1000;
function parse(value) { return typeof value === "string" ? JSON.parse(value) : value; }
async function applyIntent(pool, id, now = Date.now()) {
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    // Discover the owner without a lock, then use the same account -> draft -> task
    // lock order for all mutations. Ownership/kind are immutable and rechecked below.
    const [[hint]] = await connection.execute("SELECT account_id,kind FROM content_intents WHERE id=?", [id]);
    if (!hint) return;
    await connection.beginTransaction();
    const [[account]] = await connection.execute("SELECT * FROM accounts WHERE id=? FOR UPDATE", [hint.account_id]);
    let draft;
    if (hint.kind === "PUBLICATION") {
      [[draft]] = await connection.execute("SELECT * FROM provider_catalog_drafts WHERE provider_id=? FOR UPDATE", [hint.account_id]);
    }
    const [[intent]] = await connection.execute("SELECT * FROM content_intents WHERE id=? FOR UPDATE", [id]);
    if (!intent || !["STAGED", "PENDING"].includes(intent.status)) { await connection.commit(); return; }
    if (intent.account_id !== hint.account_id || intent.kind !== hint.kind) throw Error("INTENT_IDENTITY_CHANGED");
    const finish = async (status, code) => {
      await connection.execute("UPDATE content_intents SET status=?,result_code=?,updated_at=? WHERE id=?", [status, code, now, id]);
      await connection.commit();
      return { status, code };
    };
    const source = intent.kind === "AVATAR" ? account : draft;
    if (!account || account.status !== "ACTIVE") return await finish("FAILED", "ACCOUNT_NOT_AVAILABLE");
    if (now - Number(intent.created_at) > MAX_AGE) return await finish("EXPIRED", "WAIT_EXPIRED");
    if (!source || source.pending_content_intent_id !== id) {
      // Creation precedes linking. Do not terminally fail a just-staged task.
      if (intent.status === "STAGED") { await connection.commit(); return { status: "STAGED" }; }
      return await finish("SUPERSEDED", "CONTENT_CHANGED");
    }
    if (Number(source.version) !== Number(intent.expected_version)) return await finish("SUPERSEDED", "CONTENT_CHANGED");
    const payload = parse(intent.payload);
    if (!["AVATAR", "PUBLICATION"].includes(intent.kind) || !Array.isArray(payload.assets)) throw Error("INTENT_PAYLOAD_INVALID");
    if (intent.kind === "PUBLICATION") {
      const [[role]] = await connection.execute("SELECT role FROM account_roles WHERE account_id=? AND role='PROVIDER' FOR SHARE", [account.id]);
      const [[restriction]] = await connection.execute("SELECT status FROM provider_qualifications WHERE provider_id=? FOR SHARE", [account.id]);
      if (!role || restriction?.status === "SUSPENDED") return await finish("FAILED", "PROVIDER_NOT_AVAILABLE");
    }
    for (const expected of payload.assets) {
      const [[asset]] = await connection.execute("SELECT id,owner_account_id,purpose,status FROM media_assets WHERE id=? FOR SHARE", [expected.id]);
      if (!asset || asset.owner_account_id !== account.id || asset.purpose !== expected.purpose
        || ["REJECTED", "DELETED"].includes(asset.status)) return await finish("FAILED", "MEDIA_NOT_ACCEPTED");
      if (asset.status !== "READY") { await connection.commit(); return { status: "PENDING" }; }
      const [[check]] = await connection.execute("SELECT status,trace_id,resolved_at FROM media_security_checks WHERE asset_id=? FOR SHARE", [expected.id]);
      if (!check || check.status !== "PASS" || !check.trace_id || check.resolved_at == null) return await finish("FAILED", "MEDIA_EVIDENCE_MISSING");
    }
    if (intent.kind === "AVATAR") {
      if (payload.assets.length !== 1 || payload.assets[0].purpose !== "AVATAR") throw Error("INTENT_PAYLOAD_INVALID");
      await connection.execute("UPDATE accounts SET avatar_asset_id=?,pending_content_intent_id=NULL,version=version+1,updated_at=? WHERE id=?",
        [payload.assets[0].id, now, account.id]);
    } else {
      const [[current]] = await connection.execute("SELECT * FROM provider_catalog_publications WHERE provider_id=? FOR UPDATE", [account.id]);
      if (Number(current?.publication_version || 0) !== payload.previousPublicationVersion) return await finish("SUPERSEDED", "PUBLICATION_CHANGED");
      const publication = payload.publication;
      const previous = new Map((parse(current?.payload || "{}").works || []).map(work => [work.id, work]));
      for (const work of publication.works) {
        const old = previous.get(work.id);
        if (old) { work.referenceCount = old.referenceCount; work.code = old.code; }
      }
      if (current) {
        await connection.execute("UPDATE provider_catalog_publications SET payload=?,draft_version=?,publication_version=publication_version+1,published_at=?,updated_at=? WHERE provider_id=?",
          [JSON.stringify(publication), Number(draft.version), now, now, account.id]);
      } else {
        await connection.execute("INSERT INTO provider_catalog_publications (provider_id,payload,draft_version,publication_version,published_at,updated_at) VALUES (?,?,?,1,?,?)",
          [account.id, JSON.stringify(publication), Number(draft.version), now, now]);
      }
      await connection.execute("UPDATE provider_catalog_drafts SET pending_content_intent_id=NULL WHERE provider_id=?", [account.id]);
    }
    return await finish("APPLIED", "");
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally { if (reusable) connection.release(); else connection.destroy(); }
}
async function drain(pool, now = Date.now()) {
  const [tasks] = await pool.execute("SELECT id FROM content_intents WHERE status IN ('STAGED','PENDING') ORDER BY updated_at,id LIMIT 50");
  let processed = 0, failed = 0;
  for (const task of tasks) {
    try { await applyIntent(pool, task.id, now); }
    catch (_) { failed++; console.error("content-intent attempt failed; retained for retry"); }
    // Round-robin pending tasks, so a slow oldest task cannot starve later tasks.
    await pool.execute("UPDATE content_intents SET updated_at=? WHERE id=? AND status IN ('STAGED','PENDING')", [now, task.id]);
    processed++;
  }
  return { processed, failed };
}
module.exports = { applyIntent, drain };
