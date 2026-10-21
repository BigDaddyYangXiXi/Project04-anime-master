const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
assert.equal(require("../miniprogram/config/cloudbase").enabled, false);
const output = path.resolve(__dirname, "../.artifacts/completed-delivery-20260923");
async function run() {
  fs.mkdirSync(output, { recursive: true });
  const app = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9422" });
  try {
    let page = await app.reLaunch("/pages/order-detail/index?id=AM-260824-08&audit=1");
    await page.waitFor(300);
    assert.equal((await page.data()).completed, true);
    const buttons = await page.$$("button");
    let entry;
    for (const button of buttons) if (await button.text() === "查看交付结果") entry = button;
    assert.ok(entry, "已完成订单必须有交付入口");
    await app.pageScrollTo(100000); await page.waitFor(150);
    await app.screenshot({ path: path.join(output, "order-entry.png") });
    await entry.tap();
    for (let attempt = 0; attempt < 20; attempt++) {
      page = await app.currentPage();
      if (page.path === "pages/fulfillment/index") break;
      await page.waitFor(200);
    }
    assert.equal(page.path, "pages/fulfillment/index");
    await page.waitFor(600);
    const data = await page.data();
    assert.equal(data.order.stage, "COMPLETED");
    assert.equal(data.canAccept, false);
    assert.ok((await page.$$(".delivery-file")).length > 0);
    assert.equal((await page.$$("textarea")).length, 0);
    await app.pageScrollTo(0);
    await page.waitFor(250);
    await app.screenshot({ path: path.join(output, "delivery-top.png") });
    await app.pageScrollTo(100000); await page.waitFor(150);
    await app.screenshot({ path: path.join(output, "delivery-bottom.png") });
    await app.navigateBack();
    assert.equal((await app.currentPage()).path, "pages/order-detail/index");
    page = await app.reLaunch("/pages/fulfillment/index?id=AM-260701-10&audit=1");
    await page.waitFor(250);
    assert.equal((await page.data()).onsite, true);
    assert.ok(await page.$(".demand-copy"));
    assert.equal((await page.$$("textarea")).length, 0);
    const result = { fileDeliveryVisible: true, onsiteNoteVisible: true, backNavigation: true, completedReadOnly: true, mode: "preview-fixtures", realDownload: false };
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await app.reLaunch("/pages/discover/index"); await app.disconnect(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
