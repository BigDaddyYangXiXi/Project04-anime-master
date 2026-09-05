const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "M01");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const dashboardKey = "anime-master-v063-me-dashboard";

async function capture(miniProgram, route, name) {
  const page = await miniProgram.reLaunch(route);
  await page.waitFor(450);
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function restoreStorage(miniProgram, key, value) {
  if (value && typeof value === "object") return miniProgram.callWxMethod("setStorageSync", key, value);
  return miniProgram.callWxMethod("removeStorageSync", key);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  const originalDashboard = await miniProgram.callWxMethod("getStorageSync", dashboardKey);
  try {
    await capture(miniProgram, "/pages/me/index?audit=1&role=buyer", "01-buyer");
    await miniProgram.callWxMethod("removeStorageSync", dashboardKey);
    await capture(miniProgram, "/pages/me/index?audit=1&role=provider", "02-provider-unsynced");
    await miniProgram.callWxMethod("setStorageSync", dashboardKey, { provider: {
      account: { nickname: "已同步昵称", avatar: "" },
      storefrontStatus: "PUBLISHED",
      publishedWorksCount: 7,
      metrics: { completedOrders: 12, createdWorks: 7, workReferences: 31, workFavorites: 18, accountFollowers: 9 },
      contentAssets: { followed: 4, liked: 6, referenced: 2 }
    } });
    await capture(miniProgram, "/pages/me/index?audit=1&role=provider", "03-provider-synced");
  } finally {
    await restoreStorage(miniProgram, dashboardKey, originalDashboard);
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
