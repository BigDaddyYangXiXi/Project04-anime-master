const assert = require("assert");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function switchTab(miniProgram, route) {
  const startedAt = Date.now();
  await miniProgram.callWxMethod("switchTab", { url: route });
  const page = await miniProgram.currentPage();
  await page.waitFor(250);
  assert.strictEqual(page.path, route.replace(/^\//, ""), `底栏目标路由错误：${route}`);
  return Date.now() - startedAt;
}

async function waitForPath(miniProgram, expectedPath, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = await miniProgram.currentPage();
    if (page.path === expectedPath) return page;
    await page.waitFor(150);
  }
  return miniProgram.currentPage();
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  const originalRole = await miniProgram.callWxMethod("getStorageSync", "animeMasterRole");
  const originalProjects = await miniProgram.callWxMethod("getStorageSync", "animeMasterProjects");
  const runtimeErrors = [];
  const timings = [];
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    await miniProgram.reLaunch("/pages/discover/index");
    for (const route of ["/pages/orders/index", "/pages/projects/index", "/pages/me/index", "/pages/discover/index"]) {
      timings.push(await switchTab(miniProgram, route));
    }

    const projectsPage = await miniProgram.reLaunch("/pages/projects/index?audit=1");
    await projectsPage.waitFor(2200);
    const createButton = await projectsPage.$(".dashed-button");
    assert(createButton, "项目页必须保持可交互并显示新建项目入口");
    await createButton.tap();
    const briefPage = await waitForPath(miniProgram, "pages/brief/index");
    if (briefPage.path === "pages/projects/index") {
      process.stdout.write(`project-navigation-error:${await projectsPage.data("navigationError")}\n`);
    }
    assert.strictEqual(briefPage.path, "pages/brief/index", "点击新建项目后必须进入项目需求页");
    await miniProgram.navigateBack();

    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "provider");
    await miniProgram.switchTab("/pages/discover/index");
    for (const route of ["/pages/orders/index", "/pages/projects/index", "/pages/me/index", "/pages/discover/index"]) {
      timings.push(await switchTab(miniProgram, route));
    }
  } finally {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterProjects", originalProjects || []);
    if (originalRole) await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", originalRole);
    else await miniProgram.callWxMethod("removeStorageSync", "animeMasterRole");
    miniProgram.disconnect();
  }
  assert.deepStrictEqual(runtimeErrors, [], `底栏切换出现运行时异常：${runtimeErrors.join("\n")}`);
  process.stdout.write(`Persistent native tab-bar runtime audit passed: 8 transitions, ${timings.join("/")}ms\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
