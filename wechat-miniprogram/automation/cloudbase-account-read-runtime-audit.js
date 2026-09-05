const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const artifact = path.resolve(__dirname, "..", ".artifacts", "cloudbase-account-read-runtime.json");
  try {
    const result = await miniProgram.evaluate(async () => {
      const first = (await wx.cloud.callFunction({ name: "account-api", data: { action: "getMine" } })).result;
      const second = (await wx.cloud.callFunction({ name: "account-api", data: { action: "getMine" } })).result;
      return { first, second };
    });
    assert.equal(result.first.ok, true);
    assert.deepEqual(result.first.data, result.second.data);
    assert.equal(Number.isSafeInteger(result.first.data.version), true);
    assert.equal(JSON.stringify(result).includes("openid"), false);
    fs.mkdirSync(path.dirname(artifact), { recursive: true });
    fs.writeFileSync(artifact, JSON.stringify({ generatedAt: new Date().toISOString(), account: result.first.data, readOnly: true }, null, 2));
    console.log(`CloudBase account read-only audit passed: ${result.first.data.id}, version ${result.first.data.version}`);
  } finally { miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
