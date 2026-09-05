const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const envId = "quest-band-d1gem4bxt3fa17720";
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputPath = path.resolve(__dirname, "..", ".artifacts", "cloudbase-provider-publication-runtime.json");

async function call(miniProgram, name, data) {
  return miniProgram.evaluate(function callCloudFunction(env, functionName, payload) {
    wx.cloud.init({ env, traceUser: true });
    return wx.cloud.callFunction({ name: functionName, data: payload }).then((response) => response.result);
  }, envId, name, data);
}

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const draft = await call(miniProgram, "provider-catalog-draft", { action: "getDraft" });
    assert.equal(draft.ok, true, JSON.stringify(draft.error));
    assert.equal(draft.data.version, 0, "线上账号已有草稿，停止 QA 以免覆盖用户数据");

    const rejected = await call(miniProgram, "provider-catalog-draft", { action: "publishDraft", expectedVersion: 1 });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "DRAFT_NOT_FOUND");

    const catalog = await call(miniProgram, "catalog-read", { action: "listProviders" });
    assert.equal(catalog.ok, true, JSON.stringify(catalog.error));
    assert.deepEqual(catalog.data.providers, []);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({
      checkedAt: new Date().toISOString(),
      draftVersion: draft.data.version,
      publishGate: rejected.error.code,
      publicProviderCount: catalog.data.providers.length,
      writesPerformed: false
    }, null, 2)}\n`);
    console.log("CloudBase publication runtime audit passed: empty draft was rejected and public catalog remained empty");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
