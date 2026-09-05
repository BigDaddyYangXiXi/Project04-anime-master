const assert = require("node:assert/strict");
const test = require("node:test");
const { handleMediaSecurity } = require("./media-security-core");

const ASSET_ID = "asset_123456781234123412341234567890ab";
const FILE_ID = "cloud://quest-band-d1gem4bxt3fa17720.bucket/user-uploads/acct_me/work_image/test.png";

function createDb({ asset, check = null }) {
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
        insert(input) { operation = "insert"; value = input; return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          if (operation !== "select") writes.push({ table, operation, value, filters });
          let data = [];
          if (table === "wechat_identities") data = [{ account_id: "acct_me" }];
          else if (table === "media_assets" && asset) data = [asset];
          else if (table === "media_security_checks" && operation === "select" && check) data = [check];
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

test("submits an owned committed image with trusted openid and records the trace", async () => {
  const db = createDb({ asset: committedAsset });
  const requests = [];
  const storage = {
    getTempFileURL: async () => ({ fileList: [{ code: "SUCCESS", tempFileURL: "https://example.test/image.png" }] })
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
  assert.equal(db.writes.length, 0);
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
    getTempFileURL: async () => ({ fileList: [{ code: "SUCCESS", tempFileURL: "https://example.test/image.png" }] })
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
    providerCode: 40001,
    providerMessage: "invalid credential"
  }]);
});

test("records a sanitized SDK error without media URL or openid", async () => {
  const db = createDb({ asset: committedAsset });
  const storage = {
    getTempFileURL: async () => ({ fileList: [{ code: "SUCCESS", tempFileURL: "https://example.test/private.png" }] })
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
  assert.equal(detail.includes("OPENAPI_PERMISSION_DENIED"), true);
  assert.equal(detail.includes("openid-me"), false);
  assert.equal(detail.includes("private.png"), false);
  assert.equal(detail.includes("[redacted-url]"), true);
});
