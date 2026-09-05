const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const projectPath = path.resolve(__dirname, "..");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputDir = path.resolve(projectPath, ".artifacts", "route-smoke");
const routes = [
  ["B01", "/pages/discover/index", "buyer"],
  ["B01S", "/pages/search-results/index?career=%E5%A6%86%E5%A8%98&q=%E7%94%B7%E8%A7%92"],
  ["B02W", "/pages/work-detail/index?id=w-mu-1"],
  ["B02", "/pages/provider-detail/index?id=1"],
  ["B02C", "/pages/provider-schedule/index?id=1"],
  ["B03", "/pages/booking/index?providerId=1&workId=w-mu-1&audit=1"],
  ["B04", "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=REQUESTED"],
  ["B05", "/pages/orders/index", "buyer"],
  ["B06", "/pages/order-detail/index?id=AM-260818-03"],
  ["B07", "/pages/projects/index", "buyer"],
  ["B08", "/pages/project-detail/index?id=PJ-DEMO-0822&audit=1"],
  ["B09", "/pages/brief/index?id=PJ-DEMO-0822&audit=1"],
  ["B10", "/pages/fulfillment/index?id=AM-260823-07"],
  ["B11", "/pages/review/index?id=AM-260824-08"],
  ["M01", "/pages/me/index", "buyer"],
  ["S01", "/pages/discover/index", "provider"],
  ["S02", "/pages/provider-profile/index"],
  ["S03", "/pages/projects/index", "provider"],
  ["S06", "/pages/provider-orders/index"],
  ["S04", "/pages/provider-request/index?id=AM-260816-01&audit=1"],
  ["S05", "/pages/provider-task/index?id=AM-260816-01&audit=1"],
  ["S07", "/pages/provider-reviews/index"]
];
const group = Number(process.env.ROUTE_GROUP || 0);
const selectedRoutes = group ? routes.slice((group - 1) * 4, group * 4) : routes;

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const runtimeErrors = [];
  const report = [];
  const miniProgram = await automator.connect({ wsEndpoint });
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));

  try {
    for (const [id, url, role] of selectedRoutes) {
      if (role) await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", role);
      const page = await Promise.race([
        miniProgram.reLaunch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${id}: route timeout`)), 15000))
      ]);
      if (!page) throw new Error(`${id}: no page returned`);
      await page.waitFor(350);
      report.push({ id, url, actualPath: page.path, ok: page.path === url.split("?")[0].replace(/^\//, "") });
      process.stdout.write(`${id} ${page.path}\n`);
    }
  } finally {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer").catch(() => null);
    miniProgram.disconnect();
  }

  const result = { generatedAt: new Date().toISOString(), group: group || "all", routeCount: selectedRoutes.length, runtimeErrors, report };
  fs.writeFileSync(path.join(outputDir, group ? `report-group-${group}.json` : "report.json"), JSON.stringify(result, null, 2));
  if (runtimeErrors.length || report.some((item) => !item.ok)) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exit(1); });
