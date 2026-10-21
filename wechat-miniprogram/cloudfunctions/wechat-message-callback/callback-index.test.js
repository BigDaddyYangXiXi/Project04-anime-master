const assert = require("node:assert/strict");
const test = require("node:test");
const { persistMediaResult } = require("./index");

test('plaintext POST is rejected even with a valid handshake signature', async () => {
  const fs = require('node:fs'); const vm = require('node:vm');
  const core = require('./callback-core');
  const sandbox = { exports: {}, process: { env: { WX_CALLBACK_TOKEN: 'testtoken', WX_APP_ID: 'wx1234567890abcdef' } },
    console: { error() {} }, require(name) {
      assert.equal(name, './callback-core'); return core;
    } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  const query = { timestamp: '123', nonce: 'nonce', signature: core.sha1Signature(['testtoken', '123', 'nonce']) };
  for (const body of [{ Event: 'audit' }, { Event: 'wxa_media_check', trace_id: 'trace', result: { suggest: 'pass' } }]) {
    const result = await sandbox.exports.main({ httpMethod: 'POST', queryStringParameters: query, body: JSON.stringify(body) });
    assert.equal(result.statusCode, 403);
    assert.equal(result.body, 'forbidden');
  }
});

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

  assert.equal(db.writes[0].table, "media_security_checks");
  assert.equal(db.writes[0].value.status, "PASS");
  assert.equal(db.writes[0].value.resolved_at, 1234);
  assert.equal(db.writes[1].table, "media_assets");
  assert.equal(db.writes[1].value.status, "READY");
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

test('late pass callback cannot restore an asset quarantined for deletion', async () => {
  const db = createDb({ check: { asset_id: 'asset_cancelled', status: 'PENDING' },
    asset: { id: 'asset_cancelled', status: 'REJECTED', deleted_at: 1234 } });
  await persistMediaResult(db, { traceId: 'trace_cancelled', status: 'PASS', assetStatus: 'READY', label: 100, detail: [] }, 5678);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].table, 'media_security_checks');
});

test('callback logs never include malformed request contents or upstream error messages', async () => {
  const fs = require('node:fs'); const vm = require('node:vm');
  for (const message of ['sensitive-request-body', 'database password=sensitive-value', 'INVALID_PADDING']) {
    const logs = [];
    const sandbox = { exports: {}, process: { env: { WX_CALLBACK_TOKEN: 'testtoken', WX_APP_ID: 'wx1234567890abcdef' } },
      console: { error: value => logs.push(value) }, require(name) {
        assert.equal(name, './callback-core');
        return { parseRequestBody() { throw new Error(message); } };
      } };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
    const result = await sandbox.exports.main({ httpMethod: 'POST', body: 'sensitive-request-body' }, {});
    assert.equal(result.statusCode, 500); assert.equal(result.body, 'retry');
    assert.equal(JSON.parse(logs[0]).code, message === 'INVALID_PADDING' ? message : 'UNEXPECTED');
    assert.doesNotMatch(JSON.stringify({ result, logs }), /sensitive-|password/);
  }
});

test('database failure details do not escape persistence errors', async () => {
  const query = { select() { return this; }, eq() { return this; }, then(resolve) {
    return Promise.resolve({ error: { message: 'sensitive-database-detail' } }).then(resolve);
  } };
  await assert.rejects(() => persistMediaResult({ from: () => query }, { traceId: 'trace' }), error => {
    assert.equal(error.message, 'DATABASE_OPERATION_FAILED'); return true;
  });
});

function statefulDb(check, asset, failAssetOnce = false) {
  const writes = [];
  return { writes, from(table) {
    let value; const filters = [];
    const query = { select() { return query; }, eq(key, expected) { filters.push([key, expected]); return query; }, update(input) { value = input; return query; }, then(resolve) {
      const row = table === 'media_security_checks' ? check : asset;
      const matched = row && filters.every(([key, expected]) => row[key] === expected);
      if (value && matched) {
        if (table === 'media_assets' && failAssetOnce) {
          failAssetOnce = false; return Promise.resolve({ error: { message: 'simulated failure' } }).then(resolve);
        }
        writes.push({ table, value }); Object.assign(row, value);
      }
      return Promise.resolve({ data: matched ? [{ ...row }] : [] }).then(resolve);
    } }; return query;
  } };
}
const pass = { traceId: 'trace', status: 'PASS', assetStatus: 'READY', label: 100, detail: [] };

test('repeated error verdict repairs interrupted rejection without rewriting evidence', async () => {
  const check = { asset_id: 'asset', trace_id: 'trace', status: 'PENDING' };
  const asset = { id: 'asset', status: 'PENDING' }; const db = statefulDb(check, asset, true);
  const failed = { ...pass, status: 'ERROR', assetStatus: 'REJECTED' };
  await assert.rejects(() => persistMediaResult(db, failed, 1000), /DATABASE_OPERATION_FAILED/);
  await persistMediaResult(db, failed, 2000);
  await persistMediaResult(db, failed, 3000);
  assert.equal(asset.status, 'REJECTED');
  assert.equal(check.resolved_at, 1000);
  assert.equal(db.writes.filter(write => write.table === 'media_security_checks').length, 1);
  await assert.rejects(() => persistMediaResult(db, pass, 4000), /SECURITY_RESULT_CONFLICT/);
  assert.equal(asset.status, 'REJECTED');
});

test('persisted verdict can repair an interrupted asset write without rewriting its evidence', async () => {
  const check = { asset_id: 'asset', trace_id: 'trace', status: 'PENDING' };
  const asset = { id: 'asset', status: 'PENDING' }; const db = statefulDb(check, asset, true);
  await assert.rejects(() => persistMediaResult(db, pass, 1000), /DATABASE_OPERATION_FAILED/);
  assert.equal(check.status, 'PASS'); assert.equal(asset.status, 'PENDING');
  await persistMediaResult(db, pass, 2000);
  assert.equal(asset.status, 'READY'); assert.equal(check.resolved_at, 1000);
  assert.equal(db.writes.filter(w => w.table === 'media_security_checks').length, 1);
});

test('conflicting verdicts do not overwrite the first persisted evidence or asset', async () => {
  const check = { asset_id: 'asset', trace_id: 'trace', status: 'PENDING' };
  const asset = { id: 'asset', status: 'PENDING' }; const db = statefulDb(check, asset);
  await persistMediaResult(db, pass, 1000);
  await assert.rejects(() => persistMediaResult(db, { ...pass, status: 'RISKY', assetStatus: 'REJECTED' }, 2000), /SECURITY_RESULT_CONFLICT/);
  assert.equal(check.status, 'PASS'); assert.equal(asset.status, 'READY');
  assert.equal(check.resolved_at, 1000);
});

test('concurrent duplicate callbacks preserve one verdict and recover on retry', async () => {
  const check = { asset_id: 'asset', trace_id: 'trace', status: 'SUBMITTING' };
  const asset = { id: 'asset', status: 'PENDING' }; const db = statefulDb(check, asset);
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => persistMediaResult(db, pass, 1000)));
  for (const result of results) if (result.status === 'rejected') assert.match(result.reason.message, /SECURITY_CHECK_STATE_CONFLICT/);
  await persistMediaResult(db, pass, 2000);
  assert.equal(check.status, 'PASS'); assert.equal(asset.status, 'READY');
  assert.equal(check.resolved_at, 1000);
  assert.equal(db.writes.filter(w => w.table === 'media_security_checks').length, 1);
});
