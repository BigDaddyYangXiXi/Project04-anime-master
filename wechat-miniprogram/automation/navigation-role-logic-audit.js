const assert = require("assert");

let definition = null;
let route = "pages/discover/index";
let storedRole = "buyer";
let switchedTo = "";
let switchShouldFail = false;

global.Component = (value) => { definition = value; };
global.getCurrentPages = () => [{ route }];
global.wx = {
  getStorageSync() { return storedRole; },
  setStorageSync(key, value) { if (key === "animeMasterRole") storedRole = value; },
  switchTab({ url, success, fail }) {
    if (switchShouldFail) fail();
    else {
      switchedTo = url;
      if (success) success();
    }
  }
};

require("../miniprogram/components/main-bottom-nav/index.js");

function create() {
  const component = { data: JSON.parse(JSON.stringify(definition.data)) };
  component.setData = (patch) => Object.assign(component.data, patch);
  Object.entries(definition.methods).forEach(([key, method]) => { component[key] = method.bind(component); });
  return component;
}

const component = create();
component.syncNavigation();
assert.strictEqual(component.data.role, "buyer", "需求方路由不得被残留服务方缓存污染");
component.openRoot({ currentTarget: { dataset: { url: "/pages/me/index" } } });
assert.strictEqual(storedRole, "buyer", "从需求方底栏进入我的前必须写入需求方身份");
assert.strictEqual(switchedTo, "/pages/me/index");
assert.strictEqual(component.data.active, "me", "点击后必须立即更新底栏选中态");
assert.strictEqual(component.data.switching, false, "跳转成功必须解除重复点击锁");

route = "pages/me/index";
component.openRoot({ currentTarget: { dataset: { url: "/pages/projects/index" } } });
assert.strictEqual(switchedTo, "/pages/projects/index", "成功切换后必须允许继续点击下一入口");
assert.strictEqual(component.data.switching, false, "连续切换后不得残留锁定态");

route = "pages/provider-home/index";
storedRole = "buyer";
switchedTo = "";
component.data.switching = false;
component.syncNavigation();
assert.strictEqual(component.data.role, "provider", "服务方路由不得被残留需求方缓存污染");
component.openRoot({ currentTarget: { dataset: { url: "/pages/me/index" } } });
assert.strictEqual(storedRole, "provider", "从服务方底栏进入我的前必须写入服务方身份");
assert.strictEqual(switchedTo, "/pages/me/index");
assert.strictEqual(component.data.active, "me", "服务方点击后必须立即更新底栏选中态");

component.data.switching = false;
component.syncNavigation();
switchShouldFail = true;
component.openRoot({ currentTarget: { dataset: { url: "/pages/orders/index" } } });
assert.strictEqual(component.data.active, "dashboard", "跳转失败必须恢复原选中态");
assert.strictEqual(component.data.switching, false, "跳转失败必须解除重复点击锁");

process.stdout.write("Navigation role isolation audit passed\n");
