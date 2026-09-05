const assert = require("node:assert/strict");
const test = require("node:test");
const {
  COMMITTED_TTL_MS,
  UNCOMMITTED_TTL_MS,
  cleanupExpiredMedia,
  isExpired
} = require("./cleanup-core");

const NOW = 2_000_000_000_000;

function createDb(initialAssets) {
  const assets = initialAssets.map((asset) => ({ ...asset }));
  return {
    assets,
    from(table) {
      assert.equal(table, "media_assets");
      let operation = "select";
      let updateValue = null;
      let limitValue = Infinity;
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, value) { filters.push((row) => row[column] === value); return builder; },
        lt(column, value) { filters.push((row) => row[column] < value); return builder; },
        limit(value) { limitValue = value; return builder; },
        update(value) { operation = "update"; updateValue = value; return builder; },
        then(resolve) {
          const matched = assets.filter((row) => filters.every((filter) => filter(row))).slice(0, limitValue);
          if (operation === "update") matched.forEach((row) => Object.assign(row, updateValue));
          return Promise.resolve({ data: matched.map((row) => ({ ...row })), error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

function createStorage({ failDelete = false } = {}) {
  const deleted = [];
  return {
    deleted,
    async getUploadMetadata({ cloudPath }) {
      return { fileId: `cloud://test.bucket/${cloudPath}` };
    },
    async deleteFile({ fileList }) {
      deleted.push(...fileList);
      return { fileList: [{ fileID: fileList[0], code: failDelete ? "FAILED" : "SUCCESS" }] };
    }
  };
}

test("uses separate expiry windows for uncommitted and committed media", () => {
  assert.equal(isExpired({ status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS }, NOW), true);
  assert.equal(isExpired({ status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS + 1 }, NOW), false);
  assert.equal(isExpired({ status: "PENDING", created_at: 1, committed_at: NOW - COMMITTED_TTL_MS }, NOW), true);
  assert.equal(isExpired({ status: "PENDING", created_at: 1, committed_at: NOW - COMMITTED_TTL_MS + 1 }, NOW), false);
  assert.equal(isExpired({ status: "READY", created_at: 1 }, NOW), false);
});

test("deletes only expired pending media and is idempotent", async () => {
  const db = createDb([
    { id: "old-uncommitted", storage_key: "user-uploads/a/old.png", status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS - 1, committed_at: null },
    { id: "old-committed", storage_key: "cloud://test.bucket/old2.png", status: "PENDING", created_at: NOW - COMMITTED_TTL_MS - 1, committed_at: NOW - COMMITTED_TTL_MS - 1 },
    { id: "recent-uncommitted", storage_key: "user-uploads/a/new.png", status: "PENDING", created_at: NOW - 1000, committed_at: null },
    { id: "recent-committed", storage_key: "cloud://test.bucket/new2.png", status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS - 1, committed_at: NOW - COMMITTED_TTL_MS + 1 }
  ]);
  const storage = createStorage();

  const first = await cleanupExpiredMedia(db, storage, {}, NOW);
  const second = await cleanupExpiredMedia(db, storage, {}, NOW);

  assert.deepEqual(first, { scanned: 3, eligible: 2, deleted: 2, skipped: 0, failed: 0 });
  assert.deepEqual(second, { scanned: 1, eligible: 0, deleted: 0, skipped: 0, failed: 0 });
  assert.equal(db.assets.filter((asset) => asset.status === "DELETED").length, 2);
  assert.equal(storage.deleted.length, 2);
});

test("does not mark an asset deleted when storage deletion fails", async () => {
  const db = createDb([
    { id: "failed", storage_key: "cloud://test.bucket/failed.png", status: "PENDING", created_at: 1, committed_at: 1 }
  ]);
  const result = await cleanupExpiredMedia(db, createStorage({ failDelete: true }), {}, NOW);
  assert.deepEqual(result, { scanned: 1, eligible: 1, deleted: 0, skipped: 0, failed: 1 });
  assert.equal(db.assets[0].status, "PENDING");
});

test("manual verification can target exactly one expired asset", async () => {
  const db = createDb([
    { id: "asset_11111111111111111111111111111111", storage_key: "cloud://test.bucket/one.png", status: "PENDING", created_at: 1, committed_at: 1 },
    { id: "asset_22222222222222222222222222222222", storage_key: "cloud://test.bucket/two.png", status: "PENDING", created_at: 1, committed_at: 1 }
  ]);
  const result = await cleanupExpiredMedia(
    db,
    createStorage(),
    {},
    NOW,
    100,
    "asset_11111111111111111111111111111111"
  );
  assert.deepEqual(result, { scanned: 1, eligible: 1, deleted: 1, skipped: 0, failed: 0 });
  assert.equal(db.assets[0].status, "DELETED");
  assert.equal(db.assets[1].status, "PENDING");
});

test("rejects invocation carrying a WeChat user identity", async () => {
  await assert.rejects(
    () => cleanupExpiredMedia(createDb([]), createStorage(), { WX_OPENID: "openid-user" }, NOW),
    (error) => error.code === "CALLER_NOT_ALLOWED"
  );
});
