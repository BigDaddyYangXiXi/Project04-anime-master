const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const automator = require("miniprogram-automator");
const { sha1Signature } = require("../cloudfunctions/wechat-message-callback/callback-core");

async function run() {
  const secrets = JSON.parse(fs.readFileSync(path.join(__dirname, "../.cloudbase-cli-config/company-callback-secrets.json"), "utf8"));
  assert.equal(secrets.envId, "cloudbase-d2g65rqbvee0bd978");
  assert.equal(secrets.WX_APP_ID, "wxc94e1c1b38944511");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(12).toString("hex");
  const signature = sha1Signature([secrets.WX_CALLBACK_TOKEN, timestamp, nonce]);
  const app = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9422" });
  try {
    for (const valid of [true, false]) {
      const jobKey = `__amCallback_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
      await app.evaluate(function audit(input) {
        const job = { done: false };
        getApp()[input.jobKey] = job;
        (async () => {
          if (wx.getAccountInfoSync().miniProgram.appId !== input.appId) throw new Error("APP_ID_MISMATCH");
          wx.cloud.init({ env: input.envId, traceUser: true });
          const response = await wx.cloud.callFunction({ name: "wechat-message-callback", data: input.event });
          return response.result;
        })().then(result => { job.result = result; job.done = true; }, () => {
          job.failed = true; job.done = true;
        });
        return true;
      }, { jobKey, appId: secrets.WX_APP_ID, envId: secrets.envId, event: {
        httpMethod: "GET", queryStringParameters: { timestamp, nonce, echostr: "company-readonly-handshake", signature: valid ? signature : "0".repeat(40) }
      } });
      let observed;
      const deadline = Date.now() + 120000;
      while (!observed && Date.now() < deadline) {
        const job = await app.evaluate(function readJob(key) {
          const state = getApp()[key];
          if (!state) return { missing: true };
          return state.done ? state : { done: false };
        }, jobKey).catch(() => ({ done: false }));
        if (job.missing) throw new Error("AUDIT_JOB_MISSING");
        if (job.done) observed = job;
        else await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!observed) {
        console.error(JSON.stringify({ reason: "OBSERVATION_TIMEOUT", jobKey }));
        throw new Error("OBSERVATION_TIMEOUT");
      }
      await app.evaluate(function clearJob(key) { delete getApp()[key]; }, jobKey);
      if (observed.failed) throw new Error("CLOUD_AUDIT_FAILED");
      const result = observed.result;
      assert.equal(result.statusCode, valid ? 200 : 403);
      assert.equal(result.body, valid ? "company-readonly-handshake" : "forbidden");
      console.log(`Company callback cloud invocation: ${valid ? "valid signature accepted" : "forged signature rejected"}`);
    }
  } finally { app.disconnect(); }
}
run().catch(() => {
  console.error("Company callback invocation audit failed; raw requests and secret configuration suppressed.");
  process.exitCode = 1;
});
