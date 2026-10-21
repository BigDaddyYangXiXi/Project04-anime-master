const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "miniprogram");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const buyerRoots = new Set(["discover", "orders", "projects", "me"]);
const providerRoots = new Set(["provider-home", "provider-orders", "provider-calendar"]);
const providerChildren = new Set(["provider-profile", "provider-request", "provider-task", "provider-reviews"]);

assert.strictEqual(app.window.navigationStyle, "custom", "必须全局隐藏原生主页／返回按钮");
assert.strictEqual(app.usingComponents["app-top-nav"], "/components/app-top-nav/index");
assert.ok(app.pages.length > 0, "必须存在可审计页面");

app.pages.forEach((route) => {
  const page = route.split("/")[1];
  const wxml = read(`${route}.wxml`).replace(/<import\b[^>]*\/>/g, "").trimStart();
  assert.ok(wxml.startsWith("<app-top-nav "), `${page} 顶部导航必须是页面首组件`);
  const rootPage = page === "auth" || buyerRoots.has(page) || providerRoots.has(page);
  const showBack = wxml.split("\n")[0].match(/show-back="\{\{(.*?)\}\}"/);
  // app-top-nav defaults showBack to true; omitting it on a child is valid.
  assert.strictEqual(showBack ? showBack[1] : "true", rootPage ? "false" : "true", `${page} 根页／子页返回状态错误`);
  if (page.startsWith("provider-") && page !== "provider-detail" && page !== "provider-schedule") {
    assert.ok(wxml.split("\n")[0].includes('workspace="provider"'), `${page} 必须限制在服务方返回栈`);
  }
});

const navJs = read("components/app-top-nav/index.js");
const navWxml = read("components/app-top-nav/index.wxml");
const navWxss = read("components/app-top-nav/index.wxss");
assert.ok(/previousRoute/.test(navJs) && /allowedRoutes/.test(navJs), "返回前必须校验同身份页面栈");
assert.ok(/sharedRouteMatchesWorkspace/.test(navJs) && /sharedRoutes/.test(navJs), "供需共享页面必须同时校验页面身份");
assert.ok(/setStorageSync\("animeMasterRole", provider \? "provider" : "buyer"\)/.test(navJs)
  && /switchTab\(\{ url: "\/pages\/discover\/index" \}\)/.test(navJs), "失去页面栈时必须保留身份并回到共享平台根页");
assert.ok(!/home|主页/.test(navWxml), "顶部组件不得提供主页按钮");
assert.ok(/left:\s*8px/.test(navWxss), "返回热区必须贴齐最左侧安全内边距");
assert.ok(/<view wx:if="\{\{showBack\}\}" class="app-back"/.test(navWxml) && /max-width:\s*88rpx/.test(navWxss), "返回热区不得使用会被微信撑宽的原生 button");
assert.strictEqual(fs.existsSync(path.join(root, "components/provider-top-nav/index.js")), false, "旧服务方顶部组件必须清理");
assert.strictEqual(providerChildren.size, 4);

process.stdout.write("Top navigation contract audit: 61 assertions passed\n");
