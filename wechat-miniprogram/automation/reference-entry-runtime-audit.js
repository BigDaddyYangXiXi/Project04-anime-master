const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
assert.equal(require("../miniprogram/config/cloudbase").enabled, false);
const output = path.resolve(__dirname, "../.artifacts/reference-entry-20260923");
async function countEntries(page) {
  const buttons = await page.$$("button");
  const texts = await Promise.all(buttons.map(button => button.text()));
  return texts.filter(text => text === "查看私人参考图").length;
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  const app = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9422" });
  const results = [];
  try {
    for (const [route, id] of [["booking-status", "AM-260816-01"], ["provider-request", "AM-260818-03"], ["order-detail", "AM-260820-04"]]) {
      const page = await app.reLaunch(`/pages/${route}/index?id=${id}&audit=1`);
      await page.waitFor(700);
      assert.ok((await page.data()).order);
      if (route === "booking-status") await page.setData({ detailsOpen: true });
      // Display-state fixtures only: no cloud calls, storage writes, or reference downloads.
      await page.setData({ "order.referenceAssetId": "asset_runtime_display_only", "order.reference": "已上传参考图片", "order.privateFieldsHidden": true });
      await page.waitFor(100);
      assert.equal(await countEntries(page), 0, `${route}: hidden before authorization`);
      await page.setData({ "order.privateFieldsHidden": false });
      await page.waitFor(100);
      assert.equal(await countEntries(page), 1, `${route}: one available entry`);
      await app.pageScrollTo(0); await page.waitFor(200);
      await app.screenshot({ path: path.join(output, `${route}-top.png`) });
      await app.pageScrollTo(100000); await page.waitFor(200);
      await app.screenshot({ path: path.join(output, `${route}-bottom.png`) });
      await page.setData({ "order.referenceAssetId": null });
      assert.equal(await countEntries(page), 0, `${route}: hidden without reference`);
      results.push({ route, hidden: true, available: true, absent: true });
      console.log(JSON.stringify(results[results.length - 1]));
    }
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ mode: "local display fixtures", results, realAuthorization: false, realImage: false }, null, 2));
  } finally { await app.reLaunch("/pages/discover/index"); await app.disconnect(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
