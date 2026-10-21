const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const envId = "quest-band-d1gem4bxt3fa17720";
require("./assert-audit-environment")("wx57412ad07a806b70", envId);
const artifactPath = path.resolve(__dirname, "..", ".artifacts", "cloudbase-provider-publication-positive-runtime.json");

async function run() {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  try {
    const result = await miniProgram.evaluate(function cancelQaImage(env, assetId, fileId) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-upload",
        data: { action: "cancelUpload", assetId, fileId }
      }).then((response) => response.result);
    }, envId, artifact.assetId, artifact.fileId);
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.data.status, "DELETED");
    artifact.cleanedAt = new Date().toISOString();
    artifact.cleanupStatus = result.data.status;
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`Publication QA media cleaned: ${artifact.assetId}`);
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
