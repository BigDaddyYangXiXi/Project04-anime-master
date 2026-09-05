const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const envId = "quest-band-d1gem4bxt3fa17720";
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const result = await miniProgram.evaluate(function getProviderCatalogDraft(env) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "provider-catalog-draft",
        data: { action: "getDraft" }
      }).then((response) => response.result);
    }, envId);

    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.data.version, 0);
    assert.deepEqual(result.data.draft.services, []);
    assert.deepEqual(result.data.draft.works, []);
    assert.equal(JSON.stringify(result).includes("open_id"), false);
    assert.equal(JSON.stringify(result).includes("union_id"), false);
    console.log("CloudBase provider draft runtime audit passed: trusted user read an empty version-0 draft without writes");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
