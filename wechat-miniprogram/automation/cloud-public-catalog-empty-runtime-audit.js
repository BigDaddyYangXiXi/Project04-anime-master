const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "cloud-public-catalog-empty");

async function waitForLoad(page) {
  for (let index = 0; index < 30 && await page.data("catalogLoading"); index += 1) await page.waitFor(500);
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    let page = await miniProgram.reLaunch("/pages/discover/index");
    await waitForLoad(page);
    assert.equal(await page.data("catalogError"), "");
    assert.deepEqual(await page.data("visibleProviders"), []);
    assert.deepEqual(await page.data("visibleWorks"), []);
    await miniProgram.screenshot({ path: path.join(outputDir, "01-discover-empty.png") });

    page = await miniProgram.navigateTo("/pages/search-results/index?career=妆娘&city=杭州&q=QA");
    await waitForLoad(page);
    assert.equal(await page.data("catalogError"), "");
    assert.deepEqual(await page.data("results"), []);
    await miniProgram.screenshot({ path: path.join(outputDir, "02-search-empty.png") });
    console.log("Cloud public catalog empty runtime audit passed: buyer pages do not fall back to demo providers");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
