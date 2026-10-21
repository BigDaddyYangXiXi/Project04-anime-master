const test = require("node:test");
const assert = require("node:assert/strict");
const { applyIntent } = require("./worker-core");
function fixture(overrides = {}) {
  const state = {
    account: { id: "owner", status: "ACTIVE", version: 2, pending_content_intent_id: "intent" },
    intent: { id: "intent", account_id: "owner", kind: "AVATAR", status: "PENDING", expected_version: 2, created_at: 1000, payload: { assets: [{ id: "asset", purpose: "AVATAR" }] } },
    asset: { id: "asset", owner_account_id: "owner", purpose: "AVATAR", status: "READY" },
    check: { status: "PASS", trace_id: "trace", resolved_at: 1500 }, ...overrides
  };
  let committed = 0, rolledBack = 0, released = 0;
  const writes = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => { committed++; },
    rollback: async () => { rolledBack++; },
    release: () => { released++; },
    destroy: () => {},
    execute: async (sql, params) => {
      if (sql.startsWith("SELECT account_id")) return [[state.intent]];
      if (sql.startsWith("SELECT * FROM accounts")) return [[state.account]];
      if (sql.startsWith("SELECT * FROM content_intents")) return [[state.intent]];
      if (sql.startsWith("SELECT * FROM provider_catalog_drafts")) return [[state.draft]];
      if (sql.startsWith("SELECT role")) return [[{ role: "PROVIDER" }]];
      if (sql.startsWith("SELECT status FROM provider_qualifications")) return [[]];
      if (sql.startsWith("SELECT * FROM provider_catalog_publications")) return [state.publication ? [state.publication] : []];
      if (sql.startsWith("UPDATE provider_catalog_publications")) {
        writes.push(sql); state.publication.payload = JSON.parse(params[0]); state.publication.publication_version++; return [{}];
      }
      if (sql.startsWith("UPDATE provider_catalog_drafts")) { state.draft.pending_content_intent_id = null; return [{}]; }
      if (sql.startsWith("SELECT id,owner")) return [[state.asset]];
      if (sql.startsWith("SELECT status,trace")) return [[state.check]];
      if (sql.startsWith("UPDATE accounts")) {
        writes.push(sql); state.account.avatar_asset_id = params[0];
        state.account.pending_content_intent_id = null; state.account.version++; return [{}];
      }
      if (sql.startsWith("UPDATE content_intents")) {
        if (state.failTaskWrite) throw Error("DB_FAILURE");
        state.intent.status = params[0]; return [{}];
      }
      throw Error(`Unexpected SQL: ${sql}`);
    }
  };
  return { state, writes, pool: { getConnection: async () => connection }, counts: () => ({ committed, rolledBack, released }) };
}
test("verified owned avatar applies once and duplicate execution cannot increment version", async () => {
  const f = fixture();
  assert.equal((await applyIntent(f.pool, "intent", 2000)).status, "APPLIED");
  await applyIntent(f.pool, "intent", 2100);
  assert.equal(f.state.account.avatar_asset_id, "asset");
  assert.equal(f.state.account.version, 3); assert.equal(f.writes.length, 1);
  assert.equal(f.counts().released, 2);
});
test("pending media is not published and remains recoverable", async () => {
  const f = fixture(); f.state.asset.status = "PENDING";
  assert.equal((await applyIntent(f.pool, "intent", 2000)).status, "PENDING");
  assert.equal(f.writes.length, 0); assert.equal(f.state.intent.status, "PENDING");
});
test("replacement, version conflict, foreign owner and missing evidence cannot apply", async () => {
  for (const mutate of [
    f => { f.state.account.pending_content_intent_id = "replacement"; },
    f => { f.state.account.version++; },
    f => { f.state.asset.owner_account_id = "other"; },
    f => { f.state.asset.purpose = "WORK_IMAGE"; },
    f => { f.state.asset.status = "REJECTED"; },
    f => { f.state.check.status = "REVIEW"; },
    f => { f.state.check.trace_id = ""; }
  ]) {
    const f = fixture(); mutate(f);
    assert.ok(["FAILED", "SUPERSEDED"].includes((await applyIntent(f.pool, "intent", 2000)).status));
    assert.equal(f.writes.length, 0);
  }
});
test("failure to persist completion rolls back rather than acknowledging success", async () => {
  const f = fixture({ failTaskWrite: true });
  await assert.rejects(applyIntent(f.pool, "intent", 2000), /DB_FAILURE/);
  assert.deepEqual(f.counts(), { committed: 0, rolledBack: 1, released: 1 });
});
test("unlinked staged task waits; stale tasks expire without applying content", async () => {
  const f = fixture(); f.state.intent.status = "STAGED"; f.state.account.pending_content_intent_id = null;
  assert.equal((await applyIntent(f.pool, "intent", 2000)).status, "STAGED");
  assert.equal((await applyIntent(f.pool, "intent", 86402000)).status, "EXPIRED");
  assert.equal(f.writes.length, 0);
});
test("publication rechecks current version and preserves live reference counts", async () => {
  for (const changed of [false, true]) {
    const f = fixture({
      draft: { version: 2, pending_content_intent_id: "intent" },
      publication: { publication_version: changed ? 5 : 4, payload: { works: [{ id: "work", code: "AM-existing", referenceCount: 8 }] } }
    });
    f.state.intent.kind = "PUBLICATION";
    f.state.asset.purpose = "WORK_IMAGE";
    f.state.intent.payload = { assets: [{ id: "asset", purpose: "WORK_IMAGE" }], previousPublicationVersion: 4, publication: { works: [{ id: "work", code: "AM-existing", referenceCount: 2 }] } };
    const result = await applyIntent(f.pool, "intent", 2000);
    assert.equal(result.status, changed ? "SUPERSEDED" : "APPLIED");
    assert.equal(f.writes.length, changed ? 0 : 1);
    if (!changed) {
      assert.equal(f.state.publication.payload.works[0].referenceCount, 8);
      assert.equal(f.state.draft.pending_content_intent_id, null);
    }
  }
});
