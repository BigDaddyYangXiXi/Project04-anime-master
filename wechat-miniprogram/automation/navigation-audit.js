const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "miniprogram");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const app = JSON.parse(read("app.json"));
const pageRoot = path.join(root, "pages");
const pageNames = app.pages.map((route) => route.split("/")[1]);

assert.ok(app.tabBar && app.tabBar.custom !== true, "底栏必须使用不会遮挡正文触摸的微信原生 tabBar");
assert.strictEqual(app.tabBar.list.length, 4, "供需首页合并后必须只保留 4 个平台 tab 页");
assert.strictEqual(app.usingComponents["main-bottom-nav"], "/components/main-bottom-nav/index");
assert.ok(pageNames.length > 0, "navigation audit requires registered pages");

const focusedPages = new Set(["booking", "account-profile", "me-assets", "funds", "work-detail", "provider-profile", "auth", "account-notice", "home-preferences", "me-activity", "help", "settings", "support", "me-social"]);
const legacyRootPages = new Set(["provider-home"]);
const tabPages = new Set(app.tabBar.list.map((item) => item.pagePath.split("/")[1]));
const sharedNavPages = pageNames.filter((name) => !focusedPages.has(name) && !legacyRootPages.has(name) && !tabPages.has(name));
sharedNavPages.forEach((name) => {
  const wxml = read("pages", name, "index.wxml");
  assert.strictEqual((wxml.match(/<main-bottom-nav\b[^>]*\/>/g) || []).length, 1, `${name} must mount one shared navigation`);
});
tabPages.forEach((name) => {
  assert.strictEqual((read("pages", name, "index.wxml").match(/<main-bottom-nav\b[^>]*\/>/g) || []).length, 0, `${name} 必须由平台原生 tabBar 承载，不得重复挂载页内底栏`);
});
focusedPages.forEach((name) => {
  assert.strictEqual((read("pages", name, "index.wxml").match(/<main-bottom-nav\b[^>]*\/>/g) || []).length, 0, `${name} is a focused flow and must not expose root navigation`);
});

const navJs = read("components", "main-bottom-nav", "index.js");
[
  "找高手", "工作台", "订单", "项目", "档期", "我的",
  "/pages/discover/index",
  "/pages/orders/index", "/pages/projects/index",
  "wx.switchTab"
].forEach((value) => assert(navJs.includes(value), `navigation is missing ${value}`));
assert.ok(!navJs.includes("wx.reLaunch") && !navJs.includes("wx.redirectTo"), "底栏切换必须交给平台 switchTab，不得重建业务页层");
assert.ok(navJs.includes("switching") && navJs.includes("previousActive"), "底栏切换必须即时反馈并阻止重复跳转，失败时恢复原选中态");
assert.ok(navJs.includes("buyerRouteSet.has(route)") && navJs.includes("providerRouteSet.has(route)"), "底栏身份必须优先由当前供需业务路由判定，不得只读取历史缓存");

["market", "order", "project", "profile", "workbench", "calendar"].forEach((name) => {
  const svg = read("assets", "nav", `${name}.svg`);
  assert(svg.includes("<svg"), `${name}.svg must remain a vector asset`);
});

assert(read("pages", "work-detail", "index.wxss").includes("bottom: 0"), "作品详情业务栏贴设备底部");
assert(read("pages", "provider-detail", "index.wxss").includes("bottom: calc(var(--am-nav-bottom-content) + env(safe-area-inset-bottom))"));
const navWxss = read("components", "main-bottom-nav", "index.wxss");
assert(navWxss.includes("display: flex"));
assert(navWxss.includes("width: 25%"));
assert(!navWxss.includes("grid-template-columns"));

["discover", "orders", "projects", "me"].forEach((name) => {
  assert(read("pages", name, "index.js").includes("setTabBarItem"), `${name} 必须同步供需身份对应的原生底栏文案`);
});

console.log(`Navigation audit: ${pageNames.length} pages, ${tabPages.size} persistent tabs, ${sharedNavPages.length} deep-page navs, ${focusedPages.size} focused flows, 2 roles passed`);
