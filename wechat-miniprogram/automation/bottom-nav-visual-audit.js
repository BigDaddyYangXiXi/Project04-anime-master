const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "BOTTOM-NAV");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const timeout = (milliseconds, label) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds));

async function screenshot(miniProgram, role, route, name, first = false) {
  await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", role);
  const page = first ? await miniProgram.reLaunch(route) : (await miniProgram.callWxMethod("switchTab", { url: route }), await miniProgram.currentPage());
  await page.waitFor(500);
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  process.stdout.write("connect:start\n");
  const miniProgram = await Promise.race([automator.connect({ wsEndpoint }), timeout(12000, "connect")]);
  process.stdout.write("connect:ok\n");
  try {
    await screenshot(miniProgram, "buyer", "/pages/discover/index", "01-buyer-market", true);
    await screenshot(miniProgram, "buyer", "/pages/orders/index", "02-buyer-orders");
    await screenshot(miniProgram, "buyer", "/pages/projects/index", "03-buyer-projects");
    await screenshot(miniProgram, "buyer", "/pages/me/index", "04-buyer-me");
    await screenshot(miniProgram, "provider", "/pages/discover/index", "05-provider-dashboard");
    await screenshot(miniProgram, "provider", "/pages/orders/index", "06-provider-orders");
    await screenshot(miniProgram, "provider", "/pages/projects/index", "07-provider-calendar");
    await screenshot(miniProgram, "provider", "/pages/me/index", "08-provider-me");
  } finally {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
