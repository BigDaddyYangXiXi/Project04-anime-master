const test = require("node:test");
const assert = require("node:assert/strict");
const { handleProject } = require("./project-core");

const BUYER = "acct_buyer";
function uuid() { return "00000001-0000-0000-0000-000000000000"; }

function mockDb() {
  const projects = [];
  const orders = [
    { id: "ord_exec", buyer_id: BUYER, stage: "IN_PRODUCTION", updated_at: 3000, payload: JSON.stringify({ public: { city: "杭州", cityCode: "330100", location: "摄影棚", requirement: "完成角色正片", timeSegments: [{ startsAt: Date.UTC(2026, 8, 19, 16), endsAt: Date.UTC(2026, 8, 19, 19) }], items: [{ name: "角色摄影" }] } }) },
    { id: "ord_wait", buyer_id: BUYER, stage: "REQUESTED", updated_at: 2000, payload: JSON.stringify({ public: {} }) }
  ];
  const assets = [{ id: "asset_target", owner_account_id: BUYER, purpose: "PROJECT_TARGET", status: "READY", storage_key: "cloud://target.jpg", mime_type: "image/jpeg", size_bytes: 1000 }];
  return {
    projects, orders, assets,
    from(table) {
      let operation = "select"; let value; const filters = []; let inFilter = null;
      const builder = {
        select() { return builder; },
        eq(column, expected) { filters.push([column, expected]); return builder; },
        in(column, expected) { inFilter = [column, expected]; return builder; },
        insert(input) { operation = "insert"; value = input; return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          let source = [];
          if (table === "wechat_identities") source = [{ open_id: "openid-buyer", account_id: BUYER }];
          if (table === "accounts") source = [{ id: BUYER, status: "ACTIVE" }];
          if (table === "account_roles") source = [{ account_id: BUYER, role: "BUYER" }];
          if (table === "order_aggregates") source = orders;
          if (table === "project_aggregates") source = projects;
          if (table === "media_assets") source = assets;
          const matches = (row, column, expected) => column === "version" ? Number(row[column]) === Number(expected) : row[column] === expected;
          let data = source.filter((row) => filters.every(([column, expected]) => matches(row, column, expected)));
          if (inFilter) data = data.filter((row) => inFilter[1].includes(row[inFilter[0]]));
          if (table === "project_aggregates" && operation === "insert") { projects.push(value); data = [value]; }
          if (table === "project_aggregates" && operation === "update") {
            const row = projects.find((item) => filters.every(([column, expected]) => matches(item, column, expected)));
            if (row) { Object.assign(row, value); data = [{ id: row.id }]; } else data = [];
          }
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

test("creates one idempotent buyer project with server-derived source fields", async () => {
  const db = mockDb();
  const event = { action: "createProject", idempotencyKey: "project-request-0001" };
  const first = await handleProject(db, event, { WX_OPENID: "openid-buyer" }, 4000, uuid);
  const second = await handleProject(db, event, { WX_OPENID: "openid-buyer" }, 5000, uuid);
  assert.equal(first.id, second.id);
  assert.equal(first.city, "杭州");
  assert.match(first.description, /角色摄影/);
  assert.deepEqual(first.bookingIds, []);
  assert.equal(db.projects.length, 1);
});

test("target image links require the owned project and currently owned ready image assets", async () => {
  const db = mockDb();
  const project = await handleProject(db, { action: "createProject", idempotencyKey: "project-request-0001" }, { WX_OPENID: "openid-buyer" }, 4000, uuid);
  const event = { action: "getTargetImages", projectId: project.id, assetIds: ["asset_target"] };
  let calls = 0;
  const storage = { async getTempFileURL(input) {
    calls++;
    assert.deepEqual(input.fileList, [{ fileID: "cloud://target.jpg", maxAge: 300 }]);
    return { fileList: [{ fileID: "cloud://target.jpg", code: "SUCCESS", tempFileURL: "https://example.test/target.jpg" }] };
  } };
  const read = () => handleProject(db, event, { WX_OPENID: "openid-buyer" }, 5000, uuid, storage);
  assert.equal((await read()).images[0].url, "https://example.test/target.jpg");
  const original = { ...db.assets[0] };
  for (const change of [{ status: "REJECTED" }, { owner_account_id: "other" }, { purpose: "PROJECT_REFERENCE" }, { mime_type: "application/pdf" }, { storage_key: "https://public.test/a" }]) {
    Object.assign(db.assets[0], original, change);
    assert.equal((await read()).images[0].url, null);
  }
  assert.equal(calls, 1);
  Object.assign(db.assets[0], original);
  db.projects[0].buyer_id = "other";
  await assert.rejects(read, error => error.code === "PROJECT_NOT_FOUND");
  assert.equal(calls, 1);
});

test("target signing ignores missing, mismatched, credentialed and failed URLs", async () => {
  const db = mockDb();
  const project = await handleProject(db, { action: "createProject", idempotencyKey: "project-request-0001" }, { WX_OPENID: "openid-buyer" }, 4000, uuid);
  for (const file of [{ fileID: "other", tempFileURL: "https://example.test/a" },
    { fileID: "cloud://target.jpg", tempFileURL: "https://user:secret@example.test/a" },
    { fileID: "cloud://target.jpg", tempFileURL: "https://" },
    { fileID: "cloud://target.jpg", code: "FAILED", tempFileURL: "https://example.test/a" }]) {
    const result = await handleProject(db, { action: "getTargetImages", projectId: project.id, assetIds: ["asset_target"] },
      { WX_OPENID: "openid-buyer" }, 5000, uuid, { getTempFileURL: async () => ({ fileList: [file] }) });
    assert.equal(result.images[0].url, null);
  }
});

test("saves validated project fields and owned ready target media with version lock", async () => {
  const db = mockDb();
  const created = await handleProject(db, { action: "createProject", idempotencyKey: "project-request-0001" }, { WX_OPENID: "openid-buyer" }, 4000, uuid);
  const saved = await handleProject(db, {
    action: "saveProject", projectId: created.id, expectedVersion: 1,
    project: { title: "绮罗合作项目", date: "2026-09-20", city: "杭州", cityCode: "330100", location: "摄影棚 A", description: "完成角色正片拍摄", targetAssetIds: ["asset_target"] }
  }, { WX_OPENID: "openid-buyer" }, 5000, uuid);
  assert.equal(saved.version, 2);
  assert.equal(saved.targetImages[0].assetId, "asset_target");
  await assert.rejects(
    () => handleProject(db, { action: "saveProject", projectId: created.id, expectedVersion: 1, project: { title: "旧页面", date: "2026-09-20", city: "杭州", cityCode: "330100", location: "摄影棚", description: "旧数据", targetAssetIds: [] } }, { WX_OPENID: "openid-buyer" }, 6000, uuid),
    (error) => error.code === "VERSION_CONFLICT"
  );
});

test("normalizes a CloudBase string version before saving", async () => {
  const db = mockDb();
  const created = await handleProject(db, { action: "createProject", idempotencyKey: "project-request-0001" }, { WX_OPENID: "openid-buyer" }, 4000, uuid);
  db.projects[0].version = "1";
  db.projects[0].created_at = "4000";
  db.projects[0].updated_at = "4000";
  const read = await handleProject(db, { action: "getProject", projectId: created.id }, { WX_OPENID: "openid-buyer" }, 4500, uuid);
  assert.equal(read.version, 1);
  assert.equal(read.createdAt, 4000);
  assert.equal(read.updatedAt, 4000);
  const saved = await handleProject(db, {
    action: "saveProject", projectId: created.id, expectedVersion: read.version,
    project: { title: "云端版本项目", date: "2026-09-20", city: "杭州", cityCode: "330100", location: "摄影棚 A", description: "验证字符串版本可正常保存", targetAssetIds: [] }
  }, { WX_OPENID: "openid-buyer" }, 5000, uuid);
  assert.equal(saved.version, 2);
});

test("links only buyer execution orders, retains completed links, and unlinks without mutating orders", async () => {
  const db = mockDb();
  const created = await handleProject(db, { action: "createProject", idempotencyKey: "project-request-0001" }, { WX_OPENID: "openid-buyer" }, 4000, uuid);
  await assert.rejects(
    () => handleProject(db, { action: "linkOrder", projectId: created.id, expectedVersion: 1, orderId: "ord_wait" }, { WX_OPENID: "openid-buyer" }, 5000, uuid),
    (error) => error.code === "ORDER_NOT_ELIGIBLE"
  );
  const linked = await handleProject(db, { action: "linkOrder", projectId: created.id, expectedVersion: 1, orderId: "ord_exec" }, { WX_OPENID: "openid-buyer" }, 5000, uuid);
  db.orders[0].stage = "COMPLETED";
  const read = await handleProject(db, { action: "getProject", projectId: created.id }, { WX_OPENID: "openid-buyer" }, 6000, uuid);
  assert.deepEqual(read.bookingIds, ["ord_exec"]);
  const unlinked = await handleProject(db, { action: "unlinkOrder", projectId: created.id, expectedVersion: linked.version, orderId: "ord_exec" }, { WX_OPENID: "openid-buyer" }, 7000, uuid);
  assert.deepEqual(unlinked.bookingIds, []);
  assert.equal(db.orders[0].stage, "COMPLETED");
});

test("rejects missing trusted identity", async () => {
  await assert.rejects(() => handleProject(mockDb(), { action: "listProjects" }, {}), (error) => error.code === "AUTH_CONTEXT_MISSING");
});

test("rejects a calendar-shaped date that does not exist", async () => {
  const db = mockDb();
  const created = await handleProject(db, { action: "createProject", idempotencyKey: "project-request-0001" }, { WX_OPENID: "openid-buyer" }, 4000, uuid);
  await assert.rejects(() => handleProject(db, {
    action: "saveProject", projectId: created.id, expectedVersion: 1,
    project: { title: "错误日期", date: "2026-02-31", city: "杭州", cityCode: "330100", location: "摄影棚", description: "日期不可被自动滚动", targetAssetIds: [] }
  }, { WX_OPENID: "openid-buyer" }, 5000, uuid), (error) => error.code === "VALIDATION_ERROR");
});

test("rejects district codes in the project city field", async () => {
  const db = mockDb();
  const created = await handleProject(db, { action: "createProject", idempotencyKey: "district-code-project" }, { WX_OPENID: "openid-buyer" }, 5000, uuid);
  await assert.rejects(
    () => handleProject(db, { action: "saveProject", projectId: created.id, expectedVersion: 1, project: { title: "上海项目", date: "2026-09-20", city: "徐汇区", cityCode: "310104", location: "摄影棚", description: "验证城市级行政区代码", targetAssetIds: [] } }, { WX_OPENID: "openid-buyer" }, 6000, uuid),
    (error) => error.code === "VALIDATION_ERROR"
  );
});
