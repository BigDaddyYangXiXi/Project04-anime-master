const assert = require("node:assert/strict");
const test = require("node:test");
const { handleMediaSecurity } = require("./media-security-core");

const ASSET_ID = "asset_123456781234123412341234567890ab";
const FILE_ID = "cloud://quest-band-d1gem4bxt3fa17720.bucket/user-uploads/acct_me/work_image/test.png";

function createDb({ asset, check = null, beforeAssetUpdate }) {
  asset = asset && { ...asset };
  if (check && check.trace_id === undefined) check.trace_id = null;
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
        is(column, expected) { filters.push([column, expected]); return builder; },
        insert(input) { operation = "insert"; value = input; return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          if (operation !== "select") writes.push({ table, operation, value, filters });
          let data = [];
          if (table === "wechat_identities") data = [{ account_id: "acct_me" }];
          else if (table === "accounts") data = [{ id: "acct_me", status: "ACTIVE" }].filter(row => filters.every(([key, expected]) => row[key] === expected));
          else if (table === "media_assets" && asset) {
            if (operation === "update" && beforeAssetUpdate) beforeAssetUpdate(asset);
            if (filters.every(([key, expected]) => asset[key] === expected)) {
              if (operation === "update") Object.assign(asset, value);
              data = [{ ...asset }];
            }
          }
          else if (table === "media_security_checks") {
            if (operation === "insert") { check = { ...value }; data = [{ ...check }]; }
            else if (check && filters.every(([key, expected]) => check[key] === expected)) {
              if (operation === "update") Object.assign(check, value);
              data = [{ ...check }];
            }
          }
          else if (operation !== "select") data = [value];
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

const committedAsset = {
  id: ASSET_ID,
  owner_account_id: "acct_me",
  storage_key: FILE_ID,
  mime_type: "image/png",
  status: "PENDING",
  committed_at: 1000
};

test("terminal image status skips review-table read but still checks owner", async () => {
  for (const status of ["READY", "REJECTED"]) {
    const db = createDb({ asset: { ...committedAsset, status } });
    const from = db.from;
    db.from = table => { assert.notEqual(table, "media_security_checks"); return from(table); };
    assert.equal((await handleMediaSecurity(db, {}, {}, { action: "getImageStatus", assetId: ASSET_ID }, { WX_OPENID: "openid-me" })).status, status);
    await assert.rejects(handleMediaSecurity(db, {}, {}, { action: "getImageStatus", assetId: ASSET_ID }, {}), error => error.code === "AUTH_CONTEXT_MISSING");
  }
});

test("image actions reject non-image assets before writes or external calls", async () => {
  for (const action of ["submitImage", "getImageStatus"]) {
    for (const mime_type of ["application/pdf", "text/plain", "image/svg+xml", null]) {
      const db = createDb({ asset: { ...committedAsset, mime_type } });
      await assert.rejects(() => handleMediaSecurity(db, {}, {}, { action, assetId: ASSET_ID },
        { WX_OPENID: "openid-me" }), error => error.code === "UNSUPPORTED_MEDIA_TYPE");
      assert.equal(db.writes.length, 0);
    }
  }
});

test("rejects mismatched or invalid temporary links without submitting to WeChat", async () => {
  for (const file of [
    { fileID: "cloud://other/image.png", tempFileURL: "https://example.test/other.png" },
    { tempFileURL: "https://example.test/missing-id.png" },
    { fileID: FILE_ID, tempFileURL: "https://" },
    { fileID: FILE_ID, tempFileURL: "https://user:password@example.test/image.png" },
    { fileID: FILE_ID, tempFileURL: "http://example.test/image.png" },
    { fileID: FILE_ID, code: "FAILED", tempFileURL: "https://example.test/image.png" }
  ]) {
    const db = createDb({ asset: committedAsset });
    let calls = 0;
    await assert.rejects(() => handleMediaSecurity(db,
      { getTempFileURL: async () => ({ fileList: [file] }) },
      { callWxOpenApi: async () => { calls++; } },
      { action: "submitImage", assetId: ASSET_ID }, { WX_OPENID: "openid-me" }),
    error => error.code === "MEDIA_URL_UNAVAILABLE");
    assert.equal(calls, 0);
    assert.equal(db.writes.at(-1).value.status, "ERROR");
  }
});

test("submits an owned committed image with trusted openid and records the trace", async () => {
  const db = createDb({ asset: committedAsset });
  const requests = [];
  const storage = {
    getTempFileURL: async () => ({ fileList: [
      { fileID: "cloud://other/image.png", code: "SUCCESS", tempFileURL: "https://example.test/other.png" },
      { fileID: FILE_ID, code: "SUCCESS", tempFileURL: "https://example.test/image.png" }
    ] })
  };
  const wxApi = {
    callWxOpenApi: async (request) => {
      requests.push(request);
      return { result: { errcode: 0, errmsg: "ok", trace_id: "trace-1" } };
    }
  };

  const result = await handleMediaSecurity(db, storage, wxApi, {
    action: "submitImage", assetId: ASSET_ID, openid: "attacker"
  }, { WX_OPENID: "openid-me" }, 2000);

  assert.deepEqual(result, { assetId: ASSET_ID, status: "PENDING_SECURITY_REVIEW" });
  assert.deepEqual(requests[0], {
    apiName: "security.mediaCheckAsync",
    requestData: {
      media_url: "https://example.test/image.png",
      media_type: 2,
      version: 2,
      scene: 1,
      openid: "openid-me"
    }
  });
  assert.equal(JSON.stringify(requests).includes("attacker"), false);
  assert.equal(db.writes[0].value.status, "SUBMITTING");
  assert.equal(db.writes[1].value.trace_id, "trace-1");
  assert.equal(db.writes[1].value.status, "PENDING");
});

test("repeated submission returns the existing pending check without another WeChat call", async () => {
  const db = createDb({ asset: committedAsset, check: { asset_id: ASSET_ID, status: "PENDING", trace_id: "trace-1" } });
  let calls = 0;
  const result = await handleMediaSecurity(db, {}, {
    callWxOpenApi: async () => { calls += 1; }
  }, { action: "submitImage", assetId: ASSET_ID }, { WX_OPENID: "openid-me" }, 3000);

  assert.deepEqual(result, { assetId: ASSET_ID, status: "PENDING_SECURITY_REVIEW" });
  assert.equal(calls, 0);
  assert.equal(db.writes.length, 0);
});

test("an ERROR verdict with a trace is never reset while its asset rejection is incomplete", async () => {
  const check = { asset_id: ASSET_ID, status: "ERROR", trace_id: "trace-resolved" };
  const db = createDb({ asset: committedAsset, check });
  let calls = 0;
  const result = await handleMediaSecurity(db, { getTempFileURL: async () => { calls++; throw new Error("unexpected call"); } }, {},
    { action: "submitImage", assetId: ASSET_ID }, { WX_OPENID: "openid-me" });
  assert.equal(result.status, "PENDING_SECURITY_REVIEW");
  assert.equal(calls, 0);
  assert.equal(db.writes.length, 0);
  assert.equal(check.trace_id, "trace-resolved");
});

test("a trace persisted after the retry read prevents a stale retry claim", async () => {
  const check = { asset_id: ASSET_ID, status: "ERROR", trace_id: null };
  const db = createDb({ asset: committedAsset, check });
  const from = db.from;
  db.from = table => {
    const query = from(table); const update = query.update;
    query.update = value => {
      if (table === "media_security_checks" && value.status === "SUBMITTING") check.trace_id = "trace-newer";
      return update(value);
    };
    return query;
  };
  let calls = 0;
  await assert.rejects(() => handleMediaSecurity(db, { getTempFileURL: async () => { calls++; throw new Error("unexpected call"); } }, {},
    { action: "submitImage", assetId: ASSET_ID }, { WX_OPENID: "openid-me" }), { code: "MEDIA_STATE_CONFLICT" });
  assert.equal(calls, 0);
  assert.equal(check.trace_id, "trace-newer");
});

test("reads the final status of an owned image without resubmitting it", async () => {
  const db = createDb({
    asset: { ...committedAsset, status: "READY" },
    check: { asset_id: ASSET_ID, status: "PASS", trace_id: "trace-1" }
  });
  let calls = 0;
  const result = await handleMediaSecurity(db, {}, {
    callWxOpenApi: async () => { calls += 1; }
  }, { action: "getImageStatus", assetId: ASSET_ID }, { WX_OPENID: "openid-me" }, 3500);

  assert.deepEqual(result, { assetId: ASSET_ID, status: "READY" });
  assert.equal(calls, 0);
  assert.equal(db.writes.length, 0);
});

test("maps a pending review result to rejected without resubmitting it", async () => {
  const db = createDb({
    asset: committedAsset,
    check: { asset_id: ASSET_ID, status: "RISKY", trace_id: "trace-2" }
  });
  const result = await handleMediaSecurity(db, {}, {}, {
    action: "getImageStatus", assetId: ASSET_ID
  }, { WX_OPENID: "openid-me" }, 3600);

  assert.deepEqual(result, { assetId: ASSET_ID, status: "REJECTED" });
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].value.status, "REJECTED");
});

test("rejects an image that has not completed upload commit", async () => {
  const db = createDb({ asset: { ...committedAsset, storage_key: "user-uploads/pending.png", committed_at: null } });
  await assert.rejects(
    () => handleMediaSecurity(db, {}, {}, { action: "submitImage", assetId: ASSET_ID }, { WX_OPENID: "openid-me" }, 4000),
    (error) => error.code === "MEDIA_NOT_COMMITTED"
  );
  assert.equal(db.writes.length, 0);
});

test("records ERROR when WeChat rejects the submission", async () => {
  const db = createDb({ asset: committedAsset });
  const storage = {
    getTempFileURL: async () => ({ fileList: [{ fileID: FILE_ID, code: "SUCCESS", tempFileURL: "https://example.test/image.png" }] })
  };
  await assert.rejects(
    () => handleMediaSecurity(db, storage, {
      callWxOpenApi: async () => ({ result: { errcode: 40001, errmsg: "invalid credential" } })
    }, { action: "submitImage", assetId: ASSET_ID }, { WX_OPENID: "openid-me" }, 5000),
    (error) => error.code === "WECHAT_MEDIA_CHECK_FAILED"
  );
  const failed = db.writes.at(-1).value;
  assert.equal(failed.status, "ERROR");
  assert.deepEqual(JSON.parse(failed.detail_json), [{
    scope: "media-security-submit",
    code: "WECHAT_MEDIA_CHECK_FAILED",
    providerCode: 40001
  }]);
});

test("records a sanitized SDK error without media URL or openid", async () => {
  const db = createDb({ asset: committedAsset });
  const storage = {
    getTempFileURL: async () => ({ fileList: [{ fileID: FILE_ID, code: "SUCCESS", tempFileURL: "https://example.test/private.png" }] })
  };
  await assert.rejects(
    () => handleMediaSecurity(db, storage, {
      callWxOpenApi: async () => {
        const error = new Error("permission denied for openid-me at https://example.test/private.png");
        error.code = "OPENAPI_PERMISSION_DENIED";
        throw error;
      }
    }, { action: "submitImage", assetId: ASSET_ID }, { WX_OPENID: "openid-me" }, 6000),
    (error) => error.code === "OPENAPI_PERMISSION_DENIED"
  );
  const detail = db.writes.at(-1).value.detail_json;
  assert.equal(JSON.parse(detail)[0].code, "UNEXPECTED");
  assert.equal(detail.includes("openid-me"), false);
  assert.equal(detail.includes("private.png"), false);
  assert.equal(JSON.parse(detail)[0].providerCode, null);
});

test('losing an ERROR retry claim must not call WeChat or storage', async () => {
  const db = createDb({ asset: committedAsset, check: { asset_id: ASSET_ID, status: 'ERROR' } });
  const original = db.from;
  db.from = table => {
    const query = original(table); const update = query.update;
    query.update = input => {
      update(input);
      if (table === 'media_security_checks' && input.status === 'SUBMITTING') query.then = resolve => Promise.resolve({ data: [] }).then(resolve);
      return query;
    };
    return query;
  };
  let externalCalls = 0;
  const external = { getTempFileURL: async () => { externalCalls++; throw new Error('must not call'); } };
  await assert.rejects(() => handleMediaSecurity(db, external, {}, { action: 'submitImage', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' }), { code: 'MEDIA_STATE_CONFLICT' });
  assert.equal(externalCalls, 0);
});

test('unknown error details cannot be persisted even with object codes and private message formats', async () => {
  const db = createDb({ asset: committedAsset });
  const code = { secret: 'private-secret' }; code.self = code;
  const failure = { code, message: 'phone=13800000000 token=private-secret', details: { providerMessage: 'password=private-secret', providerCode: 'private-secret' } };
  await assert.rejects(() => handleMediaSecurity(db, { getTempFileURL: async () => { throw failure; } }, {},
    { action: 'submitImage', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' }), error => error === failure);
  const last = db.writes.at(-1).value;
  assert.equal(last.status, 'ERROR');
  assert.doesNotMatch(last.detail_json, /private-secret|13800000000|password|token/);
  assert.equal(JSON.parse(last.detail_json)[0].code, 'UNEXPECTED');
});

test('concurrent ERROR retries send at most one WeChat request', async () => {
  const check = { asset_id: ASSET_ID, status: 'ERROR', trace_id: null };
  const db = { from(table) {
    let change; const filters = [];
    const query = { select() { return query; }, eq(k, v) { filters.push([k, v]); return query; }, is(k, v) { filters.push([k, v]); return query; }, update(value) { change = value; return query; }, then(resolve) {
      const rows = table === 'wechat_identities' ? [{ account_id: 'acct_me', open_id: 'openid-me' }]
        : table === 'accounts' ? [{ id: 'acct_me', status: 'ACTIVE' }]
        : table === 'media_assets' ? [committedAsset] : [check];
      const matched = rows.filter(row => filters.every(([k, v]) => row[k] === v));
      if (change) matched.forEach(row => Object.assign(row, change));
      return Promise.resolve({ data: matched.map(row => ({ ...row })) }).then(resolve);
    } };
    return query;
  } };
  let calls = 0;
  const storage = { getTempFileURL: async () => ({ fileList: [{ fileID: FILE_ID, tempFileURL: 'https://example.test/file' }] }) };
  const api = { callWxOpenApi: async () => { calls++; return { result: { trace_id: 'trace-winner' } }; } };
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => handleMediaSecurity(db, storage, api,
    { action: 'submitImage', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' })));
  assert.equal(calls, 1);
  assert.equal(check.status, 'PENDING'); assert.equal(check.trace_id, 'trace-winner');
  assert.ok(results.some(r => r.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'MEDIA_STATE_CONFLICT');
});

test('an uncertain WeChat response stays non-retryable on a repeated submission', async () => {
  for (const outcome of ['timeout', 'missing-trace', 'adapter-error']) {
    const db = createDb({ asset: committedAsset }); let calls = 0;
    const storage = { getTempFileURL: async () => ({ fileList: [{ fileID: FILE_ID, tempFileURL: 'https://example.test/file' }] }) };
    const api = { callWxOpenApi: async () => {
      calls++;
      if (outcome === 'timeout') throw new Error('timeout');
      return outcome === 'missing-trace' ? { result: { errcode: 0 } } : { code: 'WX_OPENAPI_ERROR' };
    } };
    const request = () => handleMediaSecurity(db, storage, api, { action: 'submitImage', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
    await assert.rejects(request);
    assert.equal(db.writes.at(-1).value.status, 'SUBMITTING');
    assert.equal(db.writes.at(-1).value.resolved_at, null);
    assert.equal((await request()).status, 'PENDING_SECURITY_REVIEW');
    assert.equal(calls, 1);
  }
});

test('a known trace survives a failed pending write without making the submission retryable', async () => {
  const db = createDb({ asset: committedAsset }); const original = db.from;
  db.from = table => {
    const query = original(table); const update = query.update;
    query.update = value => {
      update(value);
      if (table === 'media_security_checks' && value.status === 'PENDING') query.then = resolve => Promise.resolve({ error: { message: 'database unavailable' } }).then(resolve);
      return query;
    }; return query;
  };
  let calls = 0;
  const storage = { getTempFileURL: async () => ({ fileList: [{ fileID: FILE_ID, tempFileURL: 'https://example.test/file' }] }) };
  const api = { callWxOpenApi: async () => { calls++; return { result: { errcode: 0, trace_id: 'known-trace' } }; } };
  const request = () => handleMediaSecurity(db, storage, api, { action: 'submitImage', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
  await assert.rejects(request, { code: 'DATABASE_OPERATION_FAILED' });
  const last = db.writes.at(-1).value;
  assert.equal(last.status, 'SUBMITTING'); assert.equal(last.trace_id, 'known-trace');
  await request(); assert.equal(calls, 1);
});

test('a saved PASS verdict is not reported as usable until the asset update has completed', async () => {
  for (const action of ['submitImage']) {
    const db = createDb({ asset: committedAsset, check: { asset_id: ASSET_ID, status: 'PASS', trace_id: 'trace' } });
    const result = await handleMediaSecurity(db, {}, {}, { action, assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
    assert.equal(result.status, 'PENDING_SECURITY_REVIEW'); assert.equal(db.writes.length, 0);
  }
});

test('failures before sending and explicit WeChat rejection remain retryable', async () => {
  for (const mode of ['url-failure', 'rejected']) {
    const db = createDb({ asset: committedAsset }); let urls = 0, calls = 0;
    const storage = { getTempFileURL: async () => {
      urls++;
      if (mode === 'url-failure' && urls === 1) throw new Error('storage unavailable');
      return { fileList: [{ fileID: FILE_ID, tempFileURL: 'https://example.test/file' }] };
    } };
    const api = { callWxOpenApi: async () => {
      calls++;
      return mode === 'rejected' && calls === 1 ? { result: { errcode: 40001 } } : { result: { errcode: 0, trace_id: 'retry-trace' } };
    } };
    const request = () => handleMediaSecurity(db, storage, api, { action: 'submitImage', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
    await assert.rejects(request);
    assert.equal(db.writes.at(-1).value.status, 'ERROR');
    assert.equal((await request()).status, 'PENDING_SECURITY_REVIEW');
    assert.equal(calls, mode === 'rejected' ? 2 : 1);
  }
});

test('status polling repairs a saved final verdict without another external request', async () => {
  for (const status of ['PASS', 'REVIEW', 'RISKY', 'ERROR']) {
    const check = { asset_id: ASSET_ID, status, trace_id: 'trace', resolved_at: 1234 };
    const db = createDb({ asset: committedAsset, check });
    const run = () => handleMediaSecurity(db, {}, {}, { action: 'getImageStatus', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
    assert.equal((await run()).status, status === 'PASS' ? 'READY' : 'REJECTED');
    assert.equal((await run()).status, status === 'PASS' ? 'READY' : 'REJECTED');
    assert.equal(db.writes.length, 1);
    assert.equal(check.resolved_at, 1234);
  }
});

test('status repair cannot revive concurrent deletion or quarantine or modify another owner', async () => {
  for (const status of ['DELETED', 'REJECTED']) {
    const db = createDb({ asset: committedAsset, check: { asset_id: ASSET_ID, status: 'PASS', trace_id: 'trace' },
      beforeAssetUpdate: asset => { asset.status = status; } });
    await assert.rejects(() => handleMediaSecurity(db, {}, {}, { action: 'getImageStatus', assetId: ASSET_ID },
      { WX_OPENID: 'openid-me' }), { code: 'MEDIA_STATE_CONFLICT' });
    assert.equal((await db.from('media_assets').select('*')).data[0].status, status);
  }
  const db = createDb({ asset: { ...committedAsset, owner_account_id: 'other' }, check: { asset_id: ASSET_ID, status: 'PASS', trace_id: 'trace' } });
  await assert.rejects(() => handleMediaSecurity(db, {}, {}, { action: 'getImageStatus', assetId: ASSET_ID },
    { WX_OPENID: 'openid-me' }), { code: 'MEDIA_NOT_FOUND' });
  assert.equal(db.writes.length, 0);
});

test('a final-looking record without an accepted trace cannot release an image', async () => {
  const db = createDb({ asset: committedAsset, check: { asset_id: ASSET_ID, status: 'PASS', trace_id: null } });
  const result = await handleMediaSecurity(db, {}, {}, { action: 'getImageStatus', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
  assert.equal(result.status, 'PENDING_SECURITY_REVIEW'); assert.equal(db.writes.length, 0);
});

test('failed recovery does not claim READY and preserves the saved verdict for retry', async () => {
  const check = { asset_id: ASSET_ID, status: 'PASS', trace_id: 'trace', resolved_at: 1234 };
  const db = createDb({ asset: committedAsset, check }); const from = db.from;
  db.from = table => {
    const query = from(table), update = query.update;
    query.update = value => {
      update(value);
      if (table === 'media_assets') query.then = resolve => Promise.resolve({ error: { message: 'unavailable' } }).then(resolve);
      return query;
    }; return query;
  };
  const run = () => handleMediaSecurity(db, {}, {}, { action: 'getImageStatus', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
  await assert.rejects(run, { code: 'DATABASE_OPERATION_FAILED' });
  assert.equal(check.status, 'PASS'); assert.equal(check.resolved_at, 1234);
  db.from = from;
  assert.equal((await run()).status, 'READY');
});

test('lost acknowledgement after a successful pending write cannot downgrade the saved trace', async () => {
  const db = createDb({ asset: committedAsset }); const original = db.from;
  db.from = table => {
    const query = original(table); const update = query.update;
    query.update = value => {
      update(value);
      if (table === 'media_security_checks' && value.status === 'PENDING') {
        const execute = query.then;
        query.then = resolve => execute(() => resolve({ error: { message: 'lost acknowledgement' } }));
      }
      return query;
    }; return query;
  };
  let calls = 0;
  const storage = { getTempFileURL: async () => ({ fileList: [{ fileID: FILE_ID, tempFileURL: 'https://example.test/file' }] }) };
  const api = { callWxOpenApi: async () => { calls++; return { result: { trace_id: 'saved-trace', errcode: 0 } }; } };
  const request = () => handleMediaSecurity(db, storage, api, { action: 'submitImage', assetId: ASSET_ID }, { WX_OPENID: 'openid-me' });
  await assert.rejects(request, { code: 'DATABASE_OPERATION_FAILED' });
  await request(); assert.equal(calls, 1);
  const row = (await db.from('media_security_checks').select('*').eq('asset_id', ASSET_ID)).data[0];
  assert.equal(row.status, 'PENDING'); assert.equal(row.trace_id, 'saved-trace');
});
