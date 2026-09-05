const assert = require("assert");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForPath(miniProgram, expectedPath) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const page = await miniProgram.currentPage();
    if (page && page.path === expectedPath) return page;
    await wait(150);
  }
  return miniProgram.currentPage();
}

async function navigation(page) {
  const component = await page.$(".app-navigation");
  assert.ok(component, `${page.path} 必须挂载共享顶部导航`);
  return { component, back: await component.$(".app-back") };
}

async function assertBackGeometry(page) {
  const { component, back } = await navigation(page);
  assert.ok(back, `${page.path} 必须显示返回按钮`);
  const navOffset = await component.offset();
  const backOffset = await back.offset();
  const size = await back.size();
  const absoluteLeft = navOffset.left + backOffset.left;
  assert.ok(absoluteLeft <= 16, `${page.path} 返回按钮必须贴齐屏幕左侧安全内边距，当前 ${absoluteLeft}px`);
  assert.ok(size.width >= 44 && size.width <= 48 && size.height >= 44, `${page.path} 返回热区必须保持 44×44px，当前 ${size.width}×${size.height}px`);
  return back;
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  const originalRole = await miniProgram.callWxMethod("getStorageSync", "animeMasterRole");
  const runtimeErrors = [];
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    const roots = ["/pages/discover/index", "/pages/orders/index", "/pages/projects/index", "/pages/me/index"];
    for (const route of roots) {
      await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
      const page = await miniProgram.reLaunch(route);
      await page.waitFor(180);
      assert.strictEqual((await navigation(page)).back, null, `${page.path} 根页不得显示返回或主页按钮`);
    }

    let page = await miniProgram.reLaunch("/pages/project-detail/index?id=PJ-DEMO-0822");
    let back = await assertBackGeometry(page);
    await back.tap();
    page = await waitForPath(miniProgram, "pages/discover/index");
    assert.strictEqual(page.path, "pages/discover/index", "需求方子页失去页面栈时必须回找高手");

    page = await miniProgram.reLaunch("/pages/provider-request/index?id=AM-260816-01&audit=1");
    back = await assertBackGeometry(page);
    await back.tap();
    page = await waitForPath(miniProgram, "pages/discover/index");
    assert.strictEqual(page.path, "pages/discover/index", "服务方子页失去页面栈时必须回共享工作台");

    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    await miniProgram.reLaunch("/pages/projects/index");
    page = await miniProgram.navigateTo("/pages/project-detail/index?id=PJ-DEMO-0822");
    back = await assertBackGeometry(page);
    await back.tap();
    page = await waitForPath(miniProgram, "pages/projects/index");
    assert.strictEqual(page.path, "pages/projects/index", "合法需求方页面栈必须真实返回来源页");

    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "provider");
    await miniProgram.reLaunch("/pages/discover/index");
    page = await miniProgram.navigateTo("/pages/provider-profile/index");
    back = await assertBackGeometry(page);
    await back.tap();
    page = await waitForPath(miniProgram, "pages/discover/index");
    assert.strictEqual(page.path, "pages/discover/index", "合法服务方页面栈必须真实返回共享工作台");

    page = await miniProgram.reLaunch("/pages/me/index?audit=1&role=provider");
    await page.callMethod("previewStorefront");
    page = await waitForPath(miniProgram, "pages/provider-detail/index");
    assert.strictEqual(page.path, "pages/provider-detail/index", "服务方我的必须进入橱窗预览");
    await page.waitFor(300);
    back = await assertBackGeometry(page);
    await back.tap();
    page = await waitForPath(miniProgram, "pages/me/index");
    assert.strictEqual(page.path, "pages/me/index", "橱窗预览必须返回服务方我的，不能回需求方主页");
    assert.strictEqual(await page.data("role"), "provider", "橱窗预览返回后必须保留服务方身份");
    assert.deepStrictEqual(runtimeErrors, [], "顶部导航流程不得产生运行时异常");
    process.stdout.write("Top navigation runtime audit passed\n");
  } finally {
    if (originalRole) await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", originalRole).catch(() => null);
    else await miniProgram.callWxMethod("removeStorageSync", "animeMasterRole").catch(() => null);
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
