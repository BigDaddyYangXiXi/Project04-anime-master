const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "DETAIL-SIZE");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const timeout = (milliseconds, label) => new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds));

async function capture(miniProgram, route, name, scrollTop = 0) {
  const page = await miniProgram.reLaunch(route);
  await page.waitFor(500);
  if (scrollTop) {
    await miniProgram.pageScrollTo(scrollTop);
    await page.waitFor(250);
  }
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  process.stdout.write("connect:start\n");
  const miniProgram = await Promise.race([automator.connect({ wsEndpoint }), timeout(12000, "connect")]);
  process.stdout.write("connect:ok\n");
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    await capture(miniProgram, "/pages/work-detail/index?id=w-mu-1", "01-work-top");
    await capture(miniProgram, "/pages/work-detail/index?id=w-mu-1", "02-work-info", 1900);
    await capture(miniProgram, "/pages/provider-detail/index?id=1", "03-provider-top");
    await capture(miniProgram, "/pages/provider-detail/index?id=1", "04-provider-services", 500);
    await capture(miniProgram, "/pages/provider-schedule/index?id=1&audit=1", "05-schedule-default");
    await capture(miniProgram, "/pages/provider-schedule/index?id=1&day=19&audit=1", "06-schedule-selected");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
