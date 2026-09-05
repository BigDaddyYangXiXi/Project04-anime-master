const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputDir = path.resolve(__dirname, "..", ".artifacts", "cloud-storefront-positive");

async function waitFor(page, field, predicate) {
  for (let index = 0; index < 30; index += 1) {
    const value = await page.data(field);
    if (predicate(value)) return value;
    await page.waitFor(500);
  }
  return page.data(field);
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/provider-detail/index?id=1&workspace=provider");
    const provider = await waitFor(page, "provider", (value) => value && value.works && value.works.length === 3);
    assert.equal(provider.works.length, 3);
    assert.equal(provider.services.length, 1);
    assert.equal(provider.works[0].coverImage.startsWith("https://"), true);
    await miniProgram.screenshot({ path: path.join(outputDir, "01-provider-top.png") });
    await miniProgram.pageScrollTo(650);
    await page.waitFor(200);
    await miniProgram.screenshot({ path: path.join(outputDir, "02-provider-services.png") });
    await miniProgram.pageScrollTo(1400);
    await page.waitFor(200);
    await miniProgram.screenshot({ path: path.join(outputDir, "03-provider-works.png") });

    page = await miniProgram.navigateTo("/pages/work-detail/index?id=qa_work_1&workspace=provider");
    const work = await waitFor(page, "work", (value) => value && value.id === "qa_work_1");
    assert.equal(work.code.startsWith("AM-"), true);
    assert.equal((await page.data("gallery")).length, 1);
    await miniProgram.screenshot({ path: path.join(outputDir, "04-work-detail.png") });
    console.log("Cloud storefront positive visual audit passed: provider, service, works and work detail use the published snapshot");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
