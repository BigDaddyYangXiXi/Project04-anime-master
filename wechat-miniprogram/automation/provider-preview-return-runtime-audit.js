const assert = require("assert");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function currentPath(miniProgram, expected) {
  for (let index = 0; index < 150; index += 1) {
    const page = await miniProgram.currentPage();
    if (page && page.path === expected) return page;
    await wait(100);
  }
  return miniProgram.currentPage();
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  const originalRole = await miniProgram.callWxMethod("getStorageSync", "animeMasterRole");
  try {
    let page = await miniProgram.reLaunch("/pages/me/index?audit=1&role=provider");
    await page.waitFor(120);
    assert.strictEqual(await page.data("role"), "provider");
    await page.callMethod("previewStorefront");
    page = await currentPath(miniProgram, "pages/provider-detail/index");
    assert.strictEqual(page.path, "pages/provider-detail/index");
    assert.strictEqual(await page.data("navWorkspace"), "provider");
    const nav = await page.$(".app-navigation");
    process.stdout.write(`preview nav workspace=${await nav.data("workspace")}\n`);
    const back = await nav.$(".app-back");
    await nav.callMethod("goBack");
    page = await currentPath(miniProgram, "pages/me/index");
    assert.strictEqual(page.path, "pages/me/index");
    assert.strictEqual(await page.data("role"), "provider");

    page = await miniProgram.navigateTo("/pages/provider-profile/index?audit=1");
    await page.waitFor(180);
    assert.strictEqual(await page.data("editing"), true);
    await page.callMethod("saveAndPreview");
    page = await currentPath(miniProgram, "pages/provider-detail/index");
    assert.strictEqual(page.path, "pages/provider-detail/index");
    assert.strictEqual(await page.data("navWorkspace"), "provider");
    assert.strictEqual(await page.data("storefrontDraftPreview"), true);
    await page.callMethod("confirmPublish");
    assert.strictEqual(await page.data("previewPublished"), true, "确认后必须进入已发布状态");
    const previewNav = await page.$(".app-navigation");
    await previewNav.callMethod("goBack");
    page = await currentPath(miniProgram, "pages/provider-profile/index");
    assert.strictEqual(page.path, "pages/provider-profile/index", "保存并预览返回时必须回橱窗编辑来源");
    assert.strictEqual(await page.data("editing"), true, "预览返回后必须恢复橱窗编辑态");
    await page.callMethod("cancelEdit");
    page = await currentPath(miniProgram, "pages/me/index");
    assert.strictEqual(page.path, "pages/me/index", "取消修改必须返回服务方来源，不得显示旧服务橱窗页");
    assert.strictEqual(await page.data("role"), "provider");
    process.stdout.write("Provider storefront preview return runtime audit passed\n");
  } finally {
    if (originalRole) await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", originalRole).catch(() => null);
    else await miniProgram.callWxMethod("removeStorageSync", "animeMasterRole").catch(() => null);
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
