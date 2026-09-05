const assert = require("node:assert/strict");

let appDefinition;
let relaunchedTo = "";
const storage = new Map();
global.App = (definition) => { appDefinition = definition; };
global.getCurrentPages = () => [{ route: "pages/provider-detail/index" }];
global.wx = {
  cloud: { init() {} },
  reLaunch({ url }) { relaunchedTo = url; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); }
};
const nativeSetTimeout = global.setTimeout;
require("../miniprogram/app.js");

global.setTimeout = (callback) => { callback(); return 1; };
appDefinition.onLaunch.call(appDefinition, {
  path: "pages/provider-detail/index",
  query: { id: "1", from: "分享" }
});
global.setTimeout = nativeSetTimeout;
assert.equal(relaunchedTo, "/pages/auth/index");
assert.equal(appDefinition.globalData.pendingRoute, "/pages/provider-detail/index?id=1&from=%E5%88%86%E4%BA%AB");

relaunchedTo = "";
global.setTimeout = (callback) => { callback(); return 1; };
appDefinition.onShow.call(appDefinition, { path: "pages/work-detail/index", query: { id: "w-1" } });
global.setTimeout = nativeSetTimeout;
assert.equal(relaunchedTo, "/pages/auth/index", "未登录热启动必须回到身份入口");
assert.equal(appDefinition.globalData.pendingRoute, "/pages/work-detail/index?id=w-1");

appDefinition.setServerSession.call(appDefinition, { account: { id: "acct-1" }, roles: ["BUYER", "PROVIDER"] });
relaunchedTo = "";
appDefinition.onShow.call(appDefinition, { path: "pages/provider-detail/index", query: { id: "2" } });
assert.equal(relaunchedTo, "", "已登录热启动不得被入口拦截");
assert.equal(appDefinition.takePostAuthRoute.call(appDefinition), "/pages/work-detail/index?id=w-1");
appDefinition.clearServerSession.call(appDefinition);
assert.equal(storage.has("animeMasterServerAccount"), false);

console.log("App authentication cold/warm deep-link gate and return-route audit passed");
