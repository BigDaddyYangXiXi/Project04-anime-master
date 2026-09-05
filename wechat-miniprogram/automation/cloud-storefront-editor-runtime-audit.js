const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const output = path.resolve(__dirname, "..", ".artifacts", "cloud-storefront-editor-empty.png");

async function run() {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const page = await miniProgram.reLaunch("/pages/provider-profile/index");
    for (let index = 0; index < 30 && await page.data("cloudLoading"); index += 1) await page.waitFor(500);
    assert.equal(await page.data("remoteEnabled"), true);
    assert.equal(await page.data("cloudLoading"), false);
    assert.equal(await page.data("cloudError"), "");
    assert.equal(await page.data("remoteDraftVersion"), 0);
    assert.deepEqual(await page.data("serviceDrafts"), []);
    assert.deepEqual(await page.data("workDrafts"), []);
    assert.equal(await page.data("canPublish"), false);
    await miniProgram.screenshot({ path: output });
    console.log("Cloud storefront editor runtime audit passed: empty server draft is visible and cannot publish");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
