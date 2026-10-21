const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { startMediaAudit } = require("./company-media-runtime-audit");

async function exercise({ appId = "company", registered = true, submit = true, failSubmit = false } = {}) {
  const app = {}; const calls = []; let uploads = 0; let localWrites = 0; let removed = 0;
  const wx = {
    env: { USER_DATA_PATH: "/test" }, getAccountInfoSync: () => ({ miniProgram: { appId } }),
    getFileSystemManager: () => ({ writeFileSync() { localWrites++; }, unlinkSync() { removed++; } }),
    cloud: { init() {}, async uploadFile() { uploads++; return { fileID: "cloud://test" }; },
      async callFunction({ data }) {
        calls.push(data.action);
        if (data.action === "submitImage" && failSubmit) throw new Error("PRIVATE_URL PRIVATE_OPENID");
        const response = data.action === "getSession" ? { registered }
          : data.action === "prepareUpload" ? { assetId: "asset_test", cloudPath: "test" }
          : data.action === "getImageStatus" ? { status: "READY" } : {};
        return { result: { ok: true, data: response } };
      } }
  };
  const started = vm.runInNewContext(`(${startMediaAudit.toString()})(input)`, {
    wx, getApp: () => app, input: { appId: "company", envId: "env", jobKey: "job", submit, png: "png", sizeBytes: 3 }, setTimeout
  });
  assert.equal(started, true);
  for (let i = 0; i < 40 && !app.job.done; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.job.done, true);
  assert.doesNotMatch(JSON.stringify(app.job), /PRIVATE_|cloud:\/\//);
  return { job: app.job, calls, uploads, localWrites, removed };
}

test("media preflight never writes or uploads", async () => {
  const result = await exercise({ submit: false });
  assert.deepEqual(result.calls, ["getSession"]);
  assert.equal(result.localWrites, 0); assert.equal(result.uploads, 0);
});
test("wrong AppID and unregistered identity stop before any media effects", async () => {
  const wrong = await exercise({ appId: "wrong" });
  assert.equal(wrong.job.failure, "APP_ID_MISMATCH"); assert.deepEqual(wrong.calls, []);
  const missing = await exercise({ registered: false });
  assert.equal(missing.job.failure, "REGISTRATION_REQUIRED");
  assert.deepEqual(missing.calls, ["getSession"]); assert.equal(missing.localWrites, 0);
});
test("media audit uploads and submits once then observes the callback status", async () => {
  const result = await exercise();
  assert.deepEqual(result.calls, ["getSession", "prepareUpload", "commitUpload", "submitImage", "getImageStatus"]);
  assert.equal(result.uploads, 1); assert.equal(result.removed, 1);
  assert.equal(result.job.stage, "CALLBACK_COMPLETE"); assert.equal(result.job.status, "READY");
});
test("unknown submission preserves the asset and does not cancel or repeat it", async () => {
  const result = await exercise({ failSubmit: true });
  assert.equal(result.job.failure, "UPSTREAM_FAILURE");
  assert.equal(result.job.assetId, "asset_test"); assert.equal(result.removed, 1);
  assert.equal(result.calls.filter(x => x === "submitImage").length, 1);
  assert.equal(result.calls.includes("cancelUpload"), false);
});
