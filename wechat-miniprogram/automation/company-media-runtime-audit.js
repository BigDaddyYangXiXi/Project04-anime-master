const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const appId = "wxc94e1c1b38944511";
const envId = "cloudbase-d2g65rqbvee0bd978";

// The automation bridge only starts this job; it never waits for its Promise.
function startMediaAudit(input) {
  const job = { done: false, stage: "IDENTITY", assetId: null };
  getApp()[input.jobKey] = job;
  (async () => {
    let localPath;
    const fail = code => { const error = new Error(code); error.code = code; throw error; };
    async function call(name, data) {
      const response = await wx.cloud.callFunction({ name, data });
      if (!response || !response.result || !response.result.ok) fail("CLOUD_REQUEST_FAILED");
      return response.result.data;
    }
    try {
      if (wx.getAccountInfoSync().miniProgram.appId !== input.appId) fail("APP_ID_MISMATCH");
      wx.cloud.init({ env: input.envId, traceUser: true });
      const session = await call("account-bootstrap", { action: "getSession" });
      job.registered = session.registered === true;
      if (!input.submit) { job.stage = "PREFLIGHT_COMPLETE"; return; }
      if (!job.registered) fail("REGISTRATION_REQUIRED");
      job.stage = "PREPARE";
      localPath = `${wx.env.USER_DATA_PATH}/${input.jobKey}.png`;
      wx.getFileSystemManager().writeFileSync(localPath, input.png, "base64");
      const prepared = await call("media-upload", { action: "prepareUpload", purpose: "WORK_IMAGE",
        mimeType: "image/png", sizeBytes: input.sizeBytes, originalFilename: "company-media-audit.png" });
      job.assetId = prepared.assetId;
      job.stage = "UPLOAD";
      const uploaded = await wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: localPath });
      job.stage = "COMMIT";
      await call("media-upload", { action: "commitUpload", assetId: job.assetId, fileId: uploaded.fileID });
      job.stage = "SUBMIT";
      await call("media-security-submit", { action: "submitImage", assetId: job.assetId });
      job.stage = "WAIT_CALLBACK";
      const deadline = Date.now() + 90000;
      do {
        const state = await call("media-security-submit", { action: "getImageStatus", assetId: job.assetId });
        job.status = state.status;
        if (["READY", "REJECTED"].includes(state.status)) { job.stage = "CALLBACK_COMPLETE"; return; }
        await new Promise(resolve => setTimeout(resolve, 3000));
      } while (Date.now() < deadline);
      fail("CALLBACK_PENDING");
    } catch (error) {
      const allowed = ["APP_ID_MISMATCH", "REGISTRATION_REQUIRED", "CLOUD_REQUEST_FAILED", "CALLBACK_PENDING"];
      job.failure = allowed.includes(error && error.code) ? error.code : "UPSTREAM_FAILURE";
    } finally {
      if (localPath) { try { wx.getFileSystemManager().unlinkSync(localPath); } catch (_) {} }
      // Retain cloud assets/results on errors. An unknown submission is not a
      // reason to cancel a potentially active check or repeat an upload.
      job.done = true;
    }
  })();
  return true;
}

async function run() {
  require("./assert-audit-environment")(appId, envId);
  const submit = process.argv.includes("--submit-test-image");
  const automator = require("miniprogram-automator");
  const mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9423" });
  const jobKey = `__amMedia_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const artifact = path.resolve(__dirname, "../.artifacts", `${jobKey}.json`);
  let lastStage;
  try {
    await mini.evaluate(startMediaAudit, { appId, envId, jobKey, submit, png, sizeBytes: Buffer.from(png, "base64").length });
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const state = await mini.evaluate(function readJob(key) {
        return getApp()[key] || { missing: true };
      }, jobKey).catch(() => null);
      if (state && state.missing) throw new Error("AUDIT_JOB_MISSING");
      if (state) {
        fs.mkdirSync(path.dirname(artifact), { recursive: true });
        fs.writeFileSync(artifact, JSON.stringify({ appId, envId, jobKey, submit, ...state }, null, 2));
        if (state.stage !== lastStage || state.done) { console.log(JSON.stringify(state)); lastStage = state.stage; }
        if (state.done) {
          await mini.evaluate(function clearJob(key) { delete getApp()[key]; }, jobKey);
          assert.ok(!state.failure, state.failure);
          return;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.error(JSON.stringify({ reason: "OBSERVATION_TIMEOUT", jobKey }));
    throw new Error("OBSERVATION_TIMEOUT");
  } finally { mini.disconnect(); }
}

if (require.main === module) run().catch(() => {
  console.error("媒体验收未完成；请查看脱敏阶段记录，不要直接重跑写入流程。");
  process.exitCode = 1;
});
module.exports = { startMediaAudit };
