const assert = require("assert");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  const originalRole = await miniProgram.callWxMethod("getStorageSync", "animeMasterRole");
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "provider");
    let page = await miniProgram.reLaunch("/pages/discover/index");
    await page.waitFor(500);
    assert.strictEqual(await page.data("role"), "provider", "共享根页必须保留用户主动选择的服务方身份");
    let mePage = await miniProgram.reLaunch("/pages/me/index");
    assert.strictEqual(await mePage.data("role"), "provider", "服务方工作台进入我的页时必须保持服务方身份");

    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    page = await miniProgram.switchTab("/pages/discover/index");
    await page.waitFor(500);
    assert.strictEqual(await page.data("role"), "buyer", "共享根页必须保留用户主动选择的需求方身份");
    mePage = await miniProgram.reLaunch("/pages/me/index");
    assert.strictEqual(await mePage.data("role"), "buyer", "需求方市场进入我的页时必须保持需求方身份");
  } finally {
    if (originalRole) await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", originalRole);
    else await miniProgram.callWxMethod("removeStorageSync", "animeMasterRole");
    miniProgram.disconnect();
  }
  process.stdout.write("M01 real-entry role isolation runtime audit passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
