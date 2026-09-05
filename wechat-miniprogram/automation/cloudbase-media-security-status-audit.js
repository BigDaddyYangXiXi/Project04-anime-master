const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const envId = "quest-band-d1gem4bxt3fa17720";
const artifactPath = path.resolve(__dirname, "..", ".artifacts", "cloudbase-media-security-runtime.json");

async function run() {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  assert.match(artifact.assetId, /^asset_[a-f0-9]{32}$/);
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const response = await miniProgram.evaluate(function readSecurityStatus(env, assetId) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({
        name: "media-security-submit",
        data: { action: "getImageStatus", assetId }
      }).then((result) => result.result);
    }, envId, artifact.assetId);
    assert.equal(response.ok, true, JSON.stringify(response.error));
    artifact.lastCheckedAt = new Date().toISOString();
    artifact.status = response.data.status;
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`CloudBase media security status: ${response.data.status}`);
    if (response.data.status !== "READY") process.exitCode = 2;
  } finally {
    await miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
