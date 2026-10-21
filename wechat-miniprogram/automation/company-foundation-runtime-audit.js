const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");
const envId = require("../miniprogram/config/cloudbase").env;
const appId = require("../project.config.json").appid;
assert.equal(envId, "cloudbase-d2g65rqbvee0bd978");
assert.equal(appId, "wxc94e1c1b38944511");
assert.equal(envId, require("../cloudbaserc.json").envId);
let stage = "CONNECT";
const startedAt = Date.now();

// Start once, then poll the same in-memory job. Never repeat a cloud request
// merely because the automation bridge stopped waiting for its response.
async function run() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  try {
    const results = [];
    const checks = [["account-bootstrap", "getSession"], ["account-api", "getMine"],
      ["catalog-read", "listProviders"], ["catalog-read", "listDiscovery"]];
    if (process.argv.includes("--business")) checks.push(["project-api", "listProjects"],
      ["saved-items-api", "listMine"], ["availability-api", "getMine"],
      ["provider-catalog-draft", "getDraft"], ["provider-catalog-draft", "getQualification"],
      ["media-upload", "getOwnedMedia"], ["media-security-submit", "getImageStatus"],
      ["project-api", "getTargetImages"]);
    for (const [name, action] of checks) {
      stage = `${name}:${action}`;
      const jobKey = `__amReadonly_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await miniProgram.evaluate(function audit(target) {
        const job = { done: false };
        getApp()[target.jobKey] = job;
        (async () => {
        const start = Date.now();
        let phase = "APP_ID_CHECK";
        try {
          if (wx.getAccountInfoSync().miniProgram.appId !== target.appId) throw new Error("APP_ID_MISMATCH");
          phase = "CLOUD_INIT";
          wx.cloud.init({ env: target.envId, traceUser: true });
          const data = target.action === "listDiscovery" ? { action: target.action, cityCode: "310000" } : { action: target.action };
          if (target.action === "getOwnedMedia") data.assetIds = ["launch-readonly-probe"];
          if (target.action === "getImageStatus") data.assetId = "asset_00000000000000000000000000000000";
          if (target.action === "getTargetImages") { data.projectId = "launch-readonly-probe"; data.assetIds = []; }
          phase = "CLOUD_CALL";
          const response = await wx.cloud.callFunction({ name: target.name, data });
          return { result: response.result, elapsedMs: Date.now() - start };
        } catch (error) {
          // Serialize only diagnostics here: automator may discard rejected SDK objects.
          const message = String(error && (error.errMsg || error.message) || "");
          const reason = /timed?\s*out|timeout/i.test(message) ? "TIMEOUT"
            : /APP_ID_MISMATCH/.test(message) ? "APP_ID_MISMATCH" : "UNCLASSIFIED";
          return { failure: { phase, reason, elapsedMs: Date.now() - start,
            numericCode: Number.isSafeInteger(error && error.errCode) ? error.errCode : null } };
        }
        })().then(value => { job.value = value; job.done = true; });
        return true;
      }, { envId, appId, name, action, jobKey });
      let observed;
      const deadline = Date.now() + 120000;
      while (!observed && Date.now() < deadline) {
        const job = await miniProgram.evaluate(function readJob(key) {
          const state = getApp()[key];
          if (!state) return { missing: true };
          if (!state.done) return { done: false };
          return { done: true, value: state.value };
        }, jobKey).catch(() => ({ done: false }));
        if (job.missing) throw new Error("AUDIT_JOB_MISSING");
        if (job.done) observed = job.value;
        else await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!observed) {
        console.error(JSON.stringify({ check: stage, reason: "OBSERVATION_TIMEOUT", jobKey }));
        throw new Error("OBSERVATION_TIMEOUT");
      }
      await miniProgram.evaluate(function clearJob(key) { delete getApp()[key]; }, jobKey);
      if (observed.failure) {
        console.error(JSON.stringify({ check: stage, ...observed.failure }));
        throw new Error("CLOUD_AUDIT_FAILED");
      }
      const result = observed.result;
      results.push(result);
      console.log(JSON.stringify({ check: stage, ok: result && result.ok, elapsedMs: observed.elapsedMs,
        expectedAccountMissing: Boolean(result && result.error && result.error.code === "ACCOUNT_NOT_FOUND") }));
    }
    stage = "ASSERT_EMPTY_BASELINE";
    assert.deepEqual(results[0], { ok: true, data: { registered: false } });
    assert.equal(results[1].ok, false);
    assert.equal(results[1].error.code, "ACCOUNT_NOT_FOUND");
    assert.deepEqual(results[2], { ok: true, data: { providers: [] } });
    assert.deepEqual(results[3], { ok: true, data: { providers: [], nextCursor: null, total: 0 } });
    for (const result of results.slice(4)) {
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "ACCOUNT_NOT_FOUND");
    }
    console.log(`Company foundation read-only audit passed: appId=${appId}, envId=${envId}, checks=${checks.length}`);
  } finally { miniProgram.disconnect(); }
}
run().catch((error) => {
  // No raw response/error payloads: they can contain identity or upstream secrets.
  const message = String(error && (error.message || error.errMsg) || "");
  const reason = /timed?\s*out|timeout/i.test(message) ? "TIMEOUT"
    : /closed|disconnect/i.test(message) ? "CONNECTION_CLOSED"
    : /APP_ID_MISMATCH/.test(message) ? "APP_ID_MISMATCH" : "UNCLASSIFIED";
  console.error(JSON.stringify({ stage, reason, elapsedMs: Date.now() - startedAt,
    numericCode: Number.isSafeInteger(error && error.errCode) ? error.errCode : null }));
  process.exitCode = 1;
});
