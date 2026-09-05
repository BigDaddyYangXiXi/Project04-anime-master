const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputDir = path.resolve(__dirname, "..", ".artifacts", "production-data-boundary");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForPath(miniProgram, expected, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = await miniProgram.currentPage();
    if (page && page.path === expected) return page;
    await wait(150);
  }
  throw new Error(`route did not settle on ${expected}`);
}

async function waitForData(page, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const data = await page.data();
    if (predicate(data)) return data;
    await page.waitFor(200);
  }
  throw new Error(`${page.path} data did not settle`);
}

async function shot(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  const runtimeErrors = [];
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    let page = await miniProgram.reLaunch("/pages/discover/index");
    let data = await waitForData(page, (value) => !value.catalogLoading);
    assert.match(data.date, /^\d{4}-\d{2}-\d{2}$/);
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const expected = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    assert.equal(data.date, expected, "B01 默认日期必须是本地明天，不能停留在历史夹具日期");
    await shot(miniProgram, "01-b01-production-top");
    await miniProgram.pageScrollTo(100000); await page.waitFor(200); await shot(miniProgram, "02-b01-production-bottom");

    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "provider");
    await miniProgram.reLaunch("/pages/provider-home/index");
    page = await waitForPath(miniProgram, "pages/discover/index");
    data = await waitForData(page, (value) => !value.dashboardLoading);
    assert.equal(data.role, "provider"); assert.equal(data.dashboardError, "");
    await shot(miniProgram, "03-legacy-s01-to-cloud-workbench");

    await miniProgram.reLaunch("/pages/provider-calendar/index");
    page = await waitForPath(miniProgram, "pages/projects/index");
    data = await waitForData(page, (value) => !value.calendarLoading);
    assert.equal(data.role, "provider"); assert.equal(data.calendarError, "");
    await shot(miniProgram, "04-legacy-s03-to-cloud-calendar");

    page = await miniProgram.reLaunch("/pages/brief/index?id=PJ-DEMO-0822&audit=1");
    const check = await page.$(".source-check");
    assert.ok(check, "B09 有历史预约时必须渲染 CSS 勾形图标");
    await shot(miniProgram, "05-b09-source-icon-top");
    await miniProgram.pageScrollTo(100000); await page.waitFor(200); await shot(miniProgram, "06-b09-source-icon-bottom");

    assert.deepEqual(runtimeErrors, []);
    process.stdout.write("Production data boundary runtime audit passed: dynamic date, 2 legacy redirects, cloud roots, B09 icon\n");
  } finally {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
