const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

async function waitUntil(page, predicate, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const data = await page.data();
    if (predicate(data)) return data;
    await page.waitFor(200);
  }
  throw new Error("page state timeout");
}

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const outputDir = path.resolve(__dirname, "..", ".artifacts", "cloud-availability-pages");
  const runtimeErrors = [];
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  fs.mkdirSync(outputDir, { recursive: true });
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "provider");
    const calendar = await miniProgram.reLaunch("/pages/projects/index");
    const data = await waitUntil(calendar, (value) => !value.calendarLoading);
    assert.equal(data.role, "provider");
    assert.equal(data.calendarLoading, false);
    assert.equal(data.calendarError, "");
    assert.equal(data.days.length, 42);
    assert.equal(data.days.filter((item) => item.valid).length, 30);
    assert.equal(data.monthTitle, "2026 年 9 月");
    assert.equal(data.days.find((item) => item.date === "2026-09-02").past, true);
    await miniProgram.screenshot({ path: path.join(outputDir, "01-provider-calendar-empty.png") });
    const schedule = await miniProgram.reLaunch("/pages/provider-schedule/index?id=acct_b9c0928373a56bb894d95639cd4aa9b4");
    const scheduleData = await waitUntil(schedule, (value) => !value.loading);
    assert.equal(scheduleData.loading, false);
    assert.equal(scheduleData.provider, null);
    assert.match(scheduleData.loadError, /没有找到服务者档期/);
    await miniProgram.screenshot({ path: path.join(outputDir, "02-unpublished-provider.png") });
    assert.deepEqual(runtimeErrors, []);
    console.log("Cloud availability pages runtime audit passed: current-month empty calendar and unpublished-provider state");
  } finally {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    miniProgram.disconnect();
  }
}
main().catch((error) => { console.error(error); process.exit(1); });
