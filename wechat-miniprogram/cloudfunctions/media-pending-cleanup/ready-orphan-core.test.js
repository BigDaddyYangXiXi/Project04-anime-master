const assert = require("node:assert/strict");
const test = require("node:test");
const { ORPHAN_QUARANTINE_MS, READY_ORPHAN_TTL_MS, cleanupReadyOrphans, collectAssetIds } = require("./ready-orphan-core");

const NOW = 2_000_000_000_000;
const OWNER = "acct_owner";
const REFERENCED = "asset_11111111111111111111111111111111";
const ORPHAN = "asset_22222222222222222222222222222222";

function createDb(seed = {}) {
  const tables = {
    media_assets: [], accounts: [], provider_profiles: [], provider_catalog_drafts: [], provider_catalog_publications: [],
    content_intents: [], support_requests: [], project_aggregates: [], order_aggregates: [], works: [], work_images: [], ...seed
  };
  return { tables, from(table) {
    const source = tables[table]; assert.ok(source, `unknown table ${table}`);
    let operation = "select"; let updateValue = null; let limitValue = Infinity; const filters = [];
    const builder = {
      select() { return builder; },
      eq(column, value) { filters.push((row) => row[column] === value); return builder; },
      lt(column, value) { filters.push((row) => Number(row[column]) < value); return builder; },
      in(column, values) { filters.push((row) => values.includes(row[column])); return builder; },
      limit(value) { limitValue = value; return builder; },
      update(value) { operation = "update"; updateValue = value; return builder; },
      then(resolve) {
        const matched = source.filter((row) => filters.every((filter) => filter(row))).slice(0, limitValue);
        if (operation === "update") matched.forEach((row) => Object.assign(row, updateValue));
        return Promise.resolve({ data: matched.map((row) => ({ ...row })), error: null }).then(resolve);
      }
    };
    return builder;
  } };
}
function storage() {
  const deleted = [];
  return { deleted, async deleteFile({ fileList }) { deleted.push(...fileList); return { fileList: [{ code: "SUCCESS" }] }; } };
}
function asset(id, status, times = {}) {
  return { id, owner_account_id: OWNER, storage_key: `cloud://bucket/${id}.png`, status, committed_at: times.committedAt || NOW - READY_ORPHAN_TTL_MS - 1, orphaned_at: times.orphanedAt || null };
}

test("collects only exact asset ids from nested snapshots", () => {
  const output = new Set(); collectAssetIds({ image: REFERENCED, nested: ["asset_bad", { id: ORPHAN }] }, output);
  assert.deepEqual([...output], [REFERENCED, ORPHAN]);
});

test('feedback attachments remain referenced and quarantined references are restored', async () => {
 const db=createDb({media_assets:[asset(REFERENCED,'ORPHAN_CANDIDATE')],support_requests:[{account_id:OWNER,payload:JSON.stringify({attachments:[{assetId:REFERENCED}]})}]});
 const files=storage(),result=await cleanupReadyOrphans(db,files,{},NOW);
 assert.equal(result.restored,1);assert.equal(db.tables.media_assets[0].status,'READY');assert.deepEqual(files.deleted,[]);
});

test("reports old unreferenced ready media without invalidating it", async () => {
  const db = createDb({
    media_assets: [asset(REFERENCED, "READY"), asset(ORPHAN, "READY")],
    accounts: [{ id: OWNER, avatar_asset_id: REFERENCED }]
  });
  const result = await cleanupReadyOrphans(db, storage(), {}, NOW);
  assert.deepEqual(result, { readyScanned: 2, quarantinedScanned: 0, quarantined: 0, restored: 0, deleted: 0, skipped: 1, failed: 0, deferred: 1 });
  assert.equal(db.tables.media_assets[0].status, "READY");
  assert.equal(db.tables.media_assets[1].status, "READY");
  assert.equal(db.tables.media_assets[1].orphaned_at, null);
});

test("restores proven references but retains unreferenced candidates", async () => {
  const oldQuarantine = NOW - ORPHAN_QUARANTINE_MS - 1;
  const db = createDb({
    media_assets: [asset(REFERENCED, "ORPHAN_CANDIDATE", { orphanedAt: oldQuarantine }), asset(ORPHAN, "ORPHAN_CANDIDATE", { orphanedAt: oldQuarantine })],
    project_aggregates: [{ buyer_id: OWNER, payload: JSON.stringify({ targetImages: [{ assetId: REFERENCED }] }) }]
  });
  const fileStorage = storage(); const result = await cleanupReadyOrphans(db, fileStorage, {}, NOW);
  assert.deepEqual(result, { readyScanned: 0, quarantinedScanned: 2, quarantined: 0, restored: 1, deleted: 0, skipped: 0, failed: 0, deferred: 1 });
  assert.equal(db.tables.media_assets[0].status, "READY");
  assert.equal(db.tables.media_assets[0].orphaned_at, null);
  assert.equal(db.tables.media_assets[1].status, "ORPHAN_CANDIDATE");
  assert.deepEqual(fileStorage.deleted, []);
});

test("keeps provider-owned delivery media referenced by provider orders", async () => {
  const db = createDb({
    media_assets: [asset(REFERENCED, "READY")],
    order_aggregates: [{ provider_id: OWNER, buyer_id: "acct_buyer", payload: JSON.stringify({ public: { deliveryFiles: [{ assetId: REFERENCED }] } }) }]
  });
  const result = await cleanupReadyOrphans(db, storage(), {}, NOW);
  assert.equal(result.skipped, 1);
  assert.equal(result.quarantined, 0);
  assert.equal(db.tables.media_assets[0].status, "READY");
});

test("fails closed on malformed reference snapshots and rejects user invocation", async () => {
  const db = createDb({ media_assets: [asset(ORPHAN, "READY")], provider_catalog_drafts: [{ provider_id: OWNER, payload: "{" }] });
  const result = await cleanupReadyOrphans(db, storage(), {}, NOW);
  assert.equal(result.failed, 1); assert.equal(db.tables.media_assets[0].status, "READY");
  await assert.rejects(() => cleanupReadyOrphans(db, storage(), { WX_OPENID: "user" }, NOW), (error) => error.code === "CALLER_NOT_ALLOWED");
});

test("a reference added after the scan cannot lose its ready file or readiness", async () => {
  const db = createDb({ media_assets: [asset(ORPHAN, "READY")] });
  const originalFrom = db.from;
  db.from = function(table) {
    const query = originalFrom(table);
    if (table === "works") {
      const originalThen = query.then;
      query.then = resolve => originalThen(result => {
        db.tables.accounts.push({ id: OWNER, avatar_asset_id: ORPHAN });
        return resolve(result);
      });
    }
    return query;
  };
  const files = storage();
  const result = await cleanupReadyOrphans(db, files, {}, NOW);
  assert.equal(db.tables.media_assets[0].status, "READY");
  assert.deepEqual(files.deleted, []);
  assert.equal(result.deferred, 1);
});

test("truncated reference results cannot authorize deletion of a quarantined file", async () => {
  const db = createDb({ media_assets: [asset(ORPHAN, 'ORPHAN_CANDIDATE', { orphanedAt: NOW - ORPHAN_QUARANTINE_MS - 1 })],
    project_aggregates: [{ buyer_id: OWNER, payload: {} }, { buyer_id: OWNER, payload: { assetId: ORPHAN } }] });
  const originalFrom = db.from;
  db.from = table => {
    const query = originalFrom(table);
    if (table === 'project_aggregates') query.limit(1);
    return query;
  };
  const files = storage();
  const result = await cleanupReadyOrphans(db, files, {}, NOW);
  assert.equal(result.deferred, 1); assert.equal(result.deleted, 0);
  assert.equal(db.tables.media_assets[0].status, 'ORPHAN_CANDIDATE');
  assert.deepEqual(files.deleted, []);
});
