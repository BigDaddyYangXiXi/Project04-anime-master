const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");
const outputDir = path.resolve(__dirname, "..", ".artifacts", "top-navigation-audit");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  const roleKey = "animeMasterRole";
  const routes = [
    ["01-buyer-root", "/pages/discover/index"],
    ["02-buyer-child", "/pages/project-detail/index?id=PJ-DEMO-0822"],
    ["03-provider-root", "/pages/provider-home/index"],
    ["04-provider-calendar-root", "/pages/provider-calendar/index"],
    ["05-provider-child", "/pages/provider-request/index?id=AM-260816-01"]
  ];
  try {
    for (const [name, route] of routes) {
      await miniProgram.callWxMethod("setStorageSync", roleKey, name.includes("provider") ? "provider" : "buyer");
      const page = await miniProgram.reLaunch(route);
      await page.waitFor(300);
      await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
      process.stdout.write(`${name}\n`);
    }
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
