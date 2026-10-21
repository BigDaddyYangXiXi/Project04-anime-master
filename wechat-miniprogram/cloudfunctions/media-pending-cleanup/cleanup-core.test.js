const assert = require("node:assert/strict");
const test = require("node:test");
const {
  COMMITTED_TTL_MS,
  UNCOMMITTED_TTL_MS,
  cleanupExpiredMedia,
  deleteFile,
  isExpired
} = require("./cleanup-core");

const NOW = 2_000_000_000_000;

function createDb(initialAssets, beforeUpdate) {
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
        is(column, value) { filters.push((row) => (row[column] ?? null) === value); return builder; },
        gt(column, value) { filters.push((row) => row[column] > value); return builder; },
        lt(column, value) { filters.push((row) => row[column] != null && row[column] < value); return builder; },
        limit(value) { limitValue = value; return builder; },
        update(value) { operation = "update"; updateValue = value; return builder; },
        then(resolve) {
          if (operation === "update" && beforeUpdate) { beforeUpdate(assets); beforeUpdate = null; }
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
      return { data: { fileId: `cloud://cloudbase-d2g65rqbvee0bd978.bucket/${cloudPath}` } };
    },
    async deleteFile({ fileList }) {
      deleted.push(...fileList);
      return { fileList: [{ fileID: fileList[0], code: failDelete ? "FAILED" : "SUCCESS" }] };
    }
  };
}

test('resolved upload metadata must match the company environment and original path before deletion', async () => {
  const cloudPath = 'user-uploads/acct_me/work_image/asset_test.png';
  const valid = `cloud://cloudbase-d2g65rqbvee0bd978.bucket/${cloudPath}`;
  for (const fileId of [valid.replace('cloudbase-d2g65rqbvee0bd978', 'other-env'),
    valid.replace('cloudbase-d2g65rqbvee0bd978', 'cloudbase-d2g65rqbvee0bd978-other'),
    valid.replace('acct_me', 'acct_other'), valid + '/extra', 'cloud://invalid', valid + '%ZZ']) {
    let deleted = false;
    const storage = {
      getUploadMetadata: async () => ({ data: { fileId } }),
      deleteFile: async () => { deleted = true; return { fileList: [{ code: 'SUCCESS', fileID: fileId }] }; }
    };
    await assert.rejects(deleteFile(storage, cloudPath), { code: 'MEDIA_FILE_ID_UNAVAILABLE' });
    assert.equal(deleted, false);
  }
  let actual;
  await deleteFile({
    getUploadMetadata: async () => ({ data: { fileId: valid } }),
    deleteFile: async ({ fileList }) => { actual = fileList; return { fileList: [{ code: 'SUCCESS', fileID: valid }] }; }
  }, cloudPath);
  assert.deepEqual(actual, [valid]);
});

test('stored file ids and uncommitted paths cannot escape the company upload root', async () => {
  const base = 'cloud://cloudbase-d2g65rqbvee0bd978.bucket/';
  for (const key of ['cloud://other.bucket/user-uploads/a/file.png', base + 'private/file.png',
    base + 'user-uploads/a/../file.png', base + 'user-uploads/a/%2e%2e/file.png',
    base + 'user-uploads//file.png', base + 'user-uploads/a/file.png?token=x',
    'user-uploads/a/../file.png', 'user-uploads/a/%2e%2e/file.png', 'user-uploads//file.png']) {
    let calls = 0;
    const storage = {
      getUploadMetadata: async () => { calls++; return {}; },
      deleteFile: async () => { calls++; return { fileList: [{ fileID: key, code: 'SUCCESS' }] }; }
    };
    await assert.rejects(deleteFile(storage, key), { code: 'MEDIA_STORAGE_KEY_INVALID' });
    assert.equal(calls, 0);
  }
});

test("uses separate expiry windows for uncommitted and committed media", () => {
  assert.equal(isExpired({ status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS }, NOW), true);
  assert.equal(isExpired({ status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS + 1 }, NOW), false);
  assert.equal(isExpired({ status: "PENDING", created_at: 1, committed_at: NOW - COMMITTED_TTL_MS }, NOW), true);
  assert.equal(isExpired({ status: "PENDING", created_at: 1, committed_at: NOW - COMMITTED_TTL_MS + 1 }, NOW), false);
  assert.equal(isExpired({ status: "READY", created_at: 1 }, NOW), false);
});

test('unexpired committed media cannot fill a batch and starve expired uploads', async () => {
  const db = createDb([
    { id: 'reviewing', storage_key: 'user-uploads/a/reviewing.png', status: 'PENDING', created_at: 1, committed_at: NOW - 1000 },
    { id: 'expired-upload', storage_key: 'user-uploads/a/expired.png', status: 'PENDING', created_at: 1, committed_at: null }
  ]);
  const storage = createStorage();
  const result = await cleanupExpiredMedia(db, storage, {}, NOW, 1);
  assert.equal(result.deleted, 1);
  assert.equal(db.assets[0].status, 'PENDING');
  assert.equal(db.assets[1].status, 'DELETED');
  assert.equal(storage.deleted.length, 1);
});

test("deletes only expired pending media and is idempotent", async () => {
  const db = createDb([
    { id: "old-uncommitted", storage_key: "user-uploads/a/old.png", status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS - 1, committed_at: null },
    { id: "old-committed", storage_key: "cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/old2.png", status: "PENDING", created_at: NOW - COMMITTED_TTL_MS - 1, committed_at: NOW - COMMITTED_TTL_MS - 1 },
    { id: "recent-uncommitted", storage_key: "user-uploads/a/new.png", status: "PENDING", created_at: NOW - 1000, committed_at: null },
    { id: "recent-committed", storage_key: "cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/new2.png", status: "PENDING", created_at: NOW - UNCOMMITTED_TTL_MS - 1, committed_at: NOW - COMMITTED_TTL_MS + 1 }
  ]);
  const storage = createStorage();

  const first = await cleanupExpiredMedia(db, storage, {}, NOW);
  const second = await cleanupExpiredMedia(db, storage, {}, NOW);

  assert.deepEqual(first, { scanned: 2, eligible: 2, deleted: 2, skipped: 0, failed: 0 });
  assert.deepEqual(second, { scanned: 0, eligible: 0, deleted: 0, skipped: 0, failed: 0 });
  assert.equal(db.assets.filter((asset) => asset.status === "DELETED").length, 2);
  assert.equal(storage.deleted.length, 2);
});

test("does not mark an asset deleted when storage deletion fails", async () => {
  const db = createDb([
    { id: "failed", storage_key: "cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/failed.png", status: "PENDING", created_at: 1, committed_at: 1 }
  ]);
  const result = await cleanupExpiredMedia(db, createStorage({ failDelete: true }), {}, NOW);
  assert.deepEqual(result, { scanned: 1, eligible: 1, deleted: 0, skipped: 0, failed: 1 });
  assert.equal(db.assets[0].status, "REJECTED");
  const retry = await cleanupExpiredMedia(db, createStorage(), {}, NOW + UNCOMMITTED_TTL_MS + 1);
  assert.equal(retry.deleted, 1);
  assert.equal(db.assets[0].status, "DELETED");
});

test('incomplete or wrong-file storage acknowledgements remain retryable, never deleted', async () => {
  const fileId = 'cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/incomplete.png';
  for (const item of [{}, { fileID: fileId }, { fileID: fileId, code: '' }, { fileID: fileId, code: 0 },
    { code: 'SUCCESS' }, { fileID: 'cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/other.png', code: 'SUCCESS' }]) {
    const db = createDb([{ id: 'incomplete', storage_key: fileId, status: 'PENDING', created_at: 1, committed_at: 1 }]);
    const result = await cleanupExpiredMedia(db, { deleteFile: async () => ({ fileList: [item] }) }, {}, NOW);
    assert.equal(result.deleted, 0); assert.equal(result.failed, 1);
    assert.equal(db.assets[0].status, 'REJECTED');
    const retry = await cleanupExpiredMedia(db, createStorage(), {}, NOW + UNCOMMITTED_TTL_MS + 1);
    assert.equal(retry.deleted, 1);
  }
});

test('review or commit winning the race prevents expired cleanup from deleting a file', async () => {
  for (const win of ['review', 'commit']) {
    const db = createDb([{ id: 'race', storage_key: 'user-uploads/a/race.png', status: 'PENDING', created_at: 1, committed_at: null }], assets => {
      if (win === 'review') assets[0].status = 'READY';
      else { assets[0].storage_key = 'cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/race.png'; assets[0].committed_at = NOW; }
    });
    const storage = createStorage();
    const result = await cleanupExpiredMedia(db, storage, {}, NOW);
    assert.equal(result.skipped, 1); assert.equal(storage.deleted.length, 0);
  }
});

test('expired cancellation retries are cleaned but unmarked moderation rejections are retained', async () => {
  const db = createDb([
    { id: 'retry', storage_key: 'cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/retry.png', status: 'REJECTED', created_at: 1, committed_at: 1, deleted_at: 2 },
    { id: 'moderation', storage_key: 'cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/moderation.png', status: 'REJECTED', created_at: 1, committed_at: 1, deleted_at: null }
  ]);
  const result = await cleanupExpiredMedia(db, createStorage(), {}, NOW);
  assert.equal(result.deleted, 1); assert.equal(db.assets[1].status, 'REJECTED');
});

test("manual verification can target exactly one expired asset", async () => {
  const db = createDb([
    { id: "asset_11111111111111111111111111111111", storage_key: "cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/one.png", status: "PENDING", created_at: 1, committed_at: 1 },
    { id: "asset_22222222222222222222222222222222", storage_key: "cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/two.png", status: "PENDING", created_at: 1, committed_at: 1 }
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

test("storage errors with circular codes cannot interrupt cleanup or leak details", async t => {
  const logs = []; t.mock.method(console, 'error', value => logs.push(value));
  const db = createDb([{ id: 'expired', status: 'PENDING', storage_key: 'cloud://cloudbase-d2g65rqbvee0bd978.bucket/user-uploads/test/file',
    created_at: NOW - UNCOMMITTED_TTL_MS - 1, committed_at: null }]);
  const code = { private: 'sensitive-secret' }; code.self = code;
  const result = await cleanupExpiredMedia(db, { async deleteFile() { throw { code, message: 'sensitive-message' }; } }, {}, NOW);
  assert.equal(result.failed, 1); assert.equal(result.deleted, 0);
  assert.equal(db.assets[0].status, 'REJECTED');
  assert.equal(JSON.parse(logs[0]).code, 'UNEXPECTED');
  assert.doesNotMatch(JSON.stringify(logs), /sensitive-/);
});
