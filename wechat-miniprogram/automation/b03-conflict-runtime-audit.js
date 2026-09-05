const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

async function run() {
  const output = path.resolve(__dirname, "..", ".artifacts", "cloud-order-cutover");
  fs.mkdirSync(output, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  try {
    const before = await miniProgram.evaluate(() => (wx.getStorageSync("anime-master-v063-orders") || []).length);
    const page = await miniProgram.reLaunch("/pages/booking/index?providerId=1&workId=w-mu-1&fixture=valid&conflict=1&audit=1");
    await page.waitFor(500);
    let data = await page.data();
    assert.equal(data.canSubmit, false);
    assert.match(data.timeError, /满客/);
    await (await page.$(".primary-block")).tap();
    await page.waitFor(200);
    data = await page.data();
    const after = await miniProgram.evaluate(() => (wx.getStorageSync("anime-master-v063-orders") || []).length);
    assert.equal(data.submitting, false);
    assert.equal(data.showValidationErrors, true);
    assert.equal(after, before);
    await miniProgram.pageScrollTo(2200);
    await page.waitFor(200);
    await miniProgram.screenshot({ path: path.join(output, "booking-conflict-current-date.png") });
    console.log("B03 current-date conflict audit passed: visible error, no submit and no local write");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
