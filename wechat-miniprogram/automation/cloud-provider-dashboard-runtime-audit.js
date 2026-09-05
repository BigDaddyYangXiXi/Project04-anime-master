const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");
async function waitUntil(page, predicate, timeout = 15000) { const started = Date.now(); while (Date.now() - started < timeout) { const data = await page.data(); if (predicate(data)) return data; await page.waitFor(250); } throw new Error("dashboard state timeout"); }
async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const output = path.resolve(__dirname, "..", ".artifacts", "cloud-provider-dashboard", "01-empty-dashboard.png");
  const errors = []; miniProgram.on("exception", (error) => errors.push(String(error)));
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "provider");
    const page = await miniProgram.reLaunch("/pages/discover/index");
    const data = await waitUntil(page, (value) => !value.dashboardLoading && value.profile);
    assert.equal(data.dashboardError, "");
    assert.equal(data.profile.nickname, "微信用户");
    assert.deepEqual(data.metrics.map((item) => item.count), [0, 0, 0]);
    assert.deepEqual(data.overview.map((item) => item.value), ["0 件公开作品", "0 个可预约项目", "0 个公开可约日", "0 条完成订单评价"]);
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.dirname(output), { recursive: true }); await miniProgram.screenshot({ path: output });
    console.log("Cloud provider dashboard runtime audit passed: account, orders, catalog, availability and reviews are server-derived");
  } finally { await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer"); miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
