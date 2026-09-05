const assert = require("node:assert/strict");
const test = require("node:test");
const { persistMediaResult } = require("./index");

function createDb({ check, asset }) {
  const writes = [];
  return {
    writes,
    from(table) {
      let operation = "select";
      let value;
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, expected) { filters.push([column, expected]); return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          if (operation === "update") writes.push({ table, value, filters });
          let data = [];
          if (operation === "select" && table === "media_security_checks" && check) data = [check];
          if (operation === "select" && table === "media_assets" && asset) data = [asset];
          if (operation === "update") data = [{ id: table === "media_assets" ? asset.id : check.asset_id }];
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

test("pass callback makes a pending asset ready and resolves its audit row", async () => {
  const db = createDb({
    check: { asset_id: "asset_1", status: "PENDING" },
    asset: { id: "asset_1", status: "PENDING" }
  });
  await persistMediaResult(db, {
    traceId: "trace_1",
    status: "PASS",
    assetStatus: "READY",
    label: 100,
    detail: []
  }, 1234);

  assert.equal(db.writes[0].table, "media_assets");
  assert.equal(db.writes[0].value.status, "READY");
  assert.equal(db.writes[1].table, "media_security_checks");
  assert.equal(db.writes[1].value.status, "PASS");
  assert.equal(db.writes[1].value.resolved_at, 1234);
});

test("callback never resurrects a deleted asset", async () => {
  const db = createDb({
    check: { asset_id: "asset_deleted", status: "PENDING" },
    asset: { id: "asset_deleted", status: "DELETED" }
  });
  await persistMediaResult(db, {
    traceId: "trace_deleted",
    status: "PASS",
    assetStatus: "READY",
    label: 100,
    detail: []
  }, 5678);

  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].table, "media_security_checks");
});

test("unknown trace requests a retry instead of silently losing the callback", async () => {
  const db = createDb({ check: null, asset: null });
  await assert.rejects(() => persistMediaResult(db, {
    traceId: "trace_missing",
    status: "RISKY",
    assetStatus: "REJECTED",
    label: 20001,
    detail: []
  }), /SECURITY_CHECK_NOT_READY/);
});
