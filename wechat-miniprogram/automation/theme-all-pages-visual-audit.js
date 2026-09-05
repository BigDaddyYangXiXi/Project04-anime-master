const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const projectPath = path.resolve(__dirname, "..");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputDir = path.join(projectPath, ".artifacts", "theme-audit", "all-pages");
const routes = [
  ["B01", "/pages/discover/index?audit=1", "buyer"],
  ["B01S", "/pages/search-results/index?career=%E5%A6%86%E5%A8%98&q=%E7%94%B7%E8%A7%92&audit=1", "buyer"],
  ["B02W", "/pages/work-detail/index?id=w-mu-1&audit=1", "buyer"],
  ["B02", "/pages/provider-detail/index?id=1&audit=1", "buyer"],
  ["B02C", "/pages/provider-schedule/index?id=1&audit=1", "buyer"],
  ["B03", "/pages/booking/index?providerId=1&workId=w-mu-1&audit=1", "buyer"],
  ["B04", "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=REQUESTED", "buyer"],
  ["B05", "/pages/orders/index?audit=1", "buyer"],
  ["B06", "/pages/order-detail/index?id=AM-260818-03&audit=1", "buyer"],
  ["B07", "/pages/projects/index?audit=1", "buyer"],
  ["B08", "/pages/project-detail/index?id=PJ-DEMO-0822&audit=1", "buyer"],
  ["B09", "/pages/brief/index?id=PJ-DEMO-0822&audit=1", "buyer"],
  ["B10", "/pages/fulfillment/index?id=AM-260823-07&audit=1", "buyer"],
  ["B11", "/pages/review/index?id=AM-260824-08&audit=1", "buyer"],
  ["M01", "/pages/me/index?audit=1&role=buyer", "buyer"],
  ["S01", "/pages/discover/index?audit=1", "provider"],
  ["S02", "/pages/provider-profile/index?audit=1", "provider"],
  ["S03", "/pages/projects/index?audit=1", "provider"],
  ["S06", "/pages/provider-orders/index?audit=1", "provider"],
  ["S04", "/pages/provider-request/index?id=AM-260816-01&audit=1", "provider"],
  ["S05", "/pages/provider-task/index?id=AM-260816-01&audit=1", "provider"],
  ["S07", "/pages/provider-reviews/index?audit=1", "provider"]
];

async function shot(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function releaseScreenshotQuota(miniProgram) {
  return miniProgram.evaluate(() => {
    const manager = wx.getFileSystemManager();
    const logDir = `${wx.env.USER_DATA_PATH}/miniprogramLog`;
    let names = [];
    try { names = manager.readdirSync(logDir); } catch (_) { return 0; }
    const files = names.map((name) => `${logDir}/${name}`);
    const totalBytes = files.reduce((total, filePath) => {
      try { return total + manager.statSync(filePath).size; } catch (_) { return total; }
    }, 0);
    if (totalBytes < 2 * 1024 * 1024) return 0;
    let removed = 0;
    files.forEach((filePath) => {
      try { manager.unlinkSync(filePath); removed += 1; } catch (_) {}
    });
    return removed;
  });
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const runtimeErrors = [];
  const miniProgram = await automator.connect({ wsEndpoint });
  const removedLogFiles = await releaseScreenshotQuota(miniProgram);
  if (removedLogFiles) process.stdout.write(`Released screenshot quota: ${removedLogFiles} DevTools log files\n`);
  const originalRole = await miniProgram.callWxMethod("getStorageSync", "animeMasterRole");
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    for (const [id, route, role] of routes) {
      await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", role);
      const page = await miniProgram.reLaunch(route);
      await page.waitFor(450);
      await shot(miniProgram, `${id}-top`);
      await miniProgram.pageScrollTo(100000);
      await page.waitFor(250);
      await shot(miniProgram, `${id}-bottom`);
    }
  } finally {
    if (originalRole) await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", originalRole).catch(() => null);
    else await miniProgram.callWxMethod("removeStorageSync", "animeMasterRole").catch(() => null);
    miniProgram.disconnect();
  }
  if (runtimeErrors.length) throw new Error(runtimeErrors.join("\n"));
  process.stdout.write(`Theme visual matrix passed: ${routes.length} routes, ${routes.length * 2} complete viewport screenshots\n`);
}

main().catch((error) => { console.error(error); process.exit(1); });
