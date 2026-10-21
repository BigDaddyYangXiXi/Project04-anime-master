const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
const output = path.resolve(__dirname, "../.artifacts/ui-iteration-2026-09-09");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const app = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9422" });
  const report = [];
  async function current(route) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const page = await app.currentPage();
      if (page && page.path === `pages/${route}/index`) { await delay(400); return page; }
      await delay(200);
    }
    throw new Error(`未到达 ${route}`);
  }
  async function capture(name) {
    await app.screenshot({ path: path.join(output, `${name}.png`) });
    report.push(name);
    console.log(name);
  }
  try {
    await app.evaluate(function () {
      wx.setStorageSync("animeMasterLocalPreview", true);
      wx.setStorageSync("animeMasterRole", "buyer");
    });
    await app.reLaunch("/pages/discover/index");
    let page = await current("discover");
    const component = await page.$(".catalog-work");
    const card = await component.$(".work-card");
    assert.ok(card);
    await app.navigateTo(await card.property("url"));
    page = await current("work-detail");
    assert.ok(await page.data("work"));
    await capture("flow-work-detail");
    await page.callMethod("openProvider");
    page = await current("provider-detail");
    await capture("flow-provider-detail");
    await page.callMethod("startBooking");
    page = await current("booking");
    assert.ok(await page.data("provider"));
    await page.callMethod("submitBooking");
    assert.equal(await page.data("showValidationErrors"), true);
    await capture("flow-booking-invalid");
    await app.navigateBack();
    await current("provider-detail");
    await app.switchTab("/pages/me/index");
    page = await current("me");
    assert.equal(await page.data("role"), "buyer");
    await capture("flow-buyer-me");
    await page.callMethod("switchIdentity");
    page = await current("discover");
    assert.equal(await page.data("role"), "provider");
    await capture("flow-provider-home");
    await app.switchTab("/pages/me/index");
    page = await current("me");
    assert.equal(await page.data("role"), "provider");
    await capture("flow-provider-me");
    await page.callMethod("editStorefront");
    page = await current("provider-profile");
    await capture("flow-provider-profile");
    await app.navigateBack();
    page = await current("me");
    await page.callMethod("openFunds");
    page = await current("funds");
    assert.equal(await page.data("loaded"), true);
    assert.equal(await page.data("loadError"), "");
    await capture("flow-funds");
    await app.switchTab("/pages/projects/index");
    page = await current("projects");
    assert.equal(await page.data("role"), "provider");
    await capture("flow-provider-calendar");
    const account = await app.evaluate(function () { return getApp().globalData.account; });
    assert.equal(account, null, "预览不能伪造已登录账户");
    console.log("页面路由、处理方法和预约校验通过；不替代原生点击与真机手势验收");
  } finally {
    fs.writeFileSync(path.join(output, "local-preview-runtime.json"), JSON.stringify({ completed: report }, null, 2));
    app.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
