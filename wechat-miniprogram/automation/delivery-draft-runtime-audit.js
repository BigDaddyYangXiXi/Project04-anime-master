const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
assert.equal(require("../miniprogram/config/cloudbase").enabled, false, "Only local preview fixtures may be used");
const output = path.resolve(__dirname, "../.artifacts/delivery-draft-20260923");
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const app = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9422" });
  try {
    const page = await app.reLaunch("/pages/provider-request/index?id=AM-260820-04&audit=1&delivery=1");
    await page.waitFor(400);
    const before = await page.data();
    assert.equal(before.isProduction, true);
    assert.equal(before.onsite, false);
    const draft = "本次交付草稿：返回页面后应保留，尚未提交。";
    await page.callMethod("updateDelivery", { detail: { value: draft } });
    await page.callMethod("onShow");
    await page.waitFor(250);
    const after = await page.data();
    assert.equal(after.delivery, draft);
    assert.deepEqual(after.deliveryFiles, before.deliveryFiles);
    await app.pageScrollTo(0);
    await app.screenshot({ path: path.join(output, "top.png") });
    await app.pageScrollTo(100000);
    await page.waitFor(200);
    await app.screenshot({ path: path.join(output, "bottom.png") });
    const result = { mode: "local-preview", path: page.path, draftRetained: true, fileCount: after.deliveryFiles.length,
      limitations: ["onShow invoked through automation, not the native file selector", "No cloud upload or order submission", "Not a real-device acceptance"] };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await app.reLaunch("/pages/discover/index");
    await app.disconnect();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
