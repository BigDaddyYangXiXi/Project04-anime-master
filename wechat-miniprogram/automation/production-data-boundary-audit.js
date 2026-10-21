const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "miniprogram", "pages");
const read = (page) => fs.readFileSync(path.join(root, page, "index.js"), "utf8");
const cloudPages = [
  "account-profile", "booking", "booking-status", "brief", "discover", "fulfillment", "funds", "me", "me-assets",
  "order-detail", "orders", "project-detail", "projects", "provider-detail", "provider-orders", "provider-profile",
  "provider-request", "provider-reviews", "provider-schedule", "provider-task", "review", "search-results", "work-detail"
];

for (const page of cloudPages) {
  assert.ok(!read(page).includes(".isAvailable()"), `${page} 生产入口不得因云能力探测失败静默回退本地夹具`);
}

const legacyHome = read("provider-home");
assert.ok(!read("funds").includes("v063-store") && read("funds").includes("cloudOrders.getProviderFunds"), "资金页必须读取本人云端付款记录，不能读取演示余额");
const legacyCalendar = read("provider-calendar");
for (const enabled of [true, false]) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "../utils/local-preview.js"), "utf8"), {
    module, require: () => ({ enabled }),
    wx: { getAccountInfoSync: () => ({ miniProgram: { envVersion: enabled ? "develop" : "release" } }),
      getDeviceInfo: () => ({ platform: "devtools" }) }
  });
  for (const [source, target] of [[legacyHome, "/pages/discover/index"], [legacyCalendar, "/pages/projects/index"]]) {
    for (const options of [{}, { audit: "1", changed: "1" }]) {
      let page, destination;
      vm.runInNewContext(source, {
        require: name => name.endsWith("local-preview") ? module.exports : {},
        Page: definition => { page = definition; },
        wx: { setStorageSync() {}, switchTab: ({ url }) => { destination = url; } }
      });
      page.onLoad(options);
      // No fixture methods or setData are provided: reading/rendering demos fails this check.
      page.onShow();
      assert.equal(destination, target, "正式版及已连接云的版本不能通过旧入口或audit参数进入演示页");
      assert.equal(page.redirecting, true);
    }
  }
}

const discover = read("discover");
assert.match(discover, /date: this\.auditMode \? "2026-08-16" : tomorrowKey\(\)/);
assert.match(discover, /date: ""/);
assert.match(discover, /function tomorrowKey/);

process.stdout.write(`Production data boundary audit passed: ${cloudPages.length} cloud pages, 8 legacy route checks, dynamic booking date\n`);
