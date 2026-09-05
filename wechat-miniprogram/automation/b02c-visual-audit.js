const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B02C");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function capture(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/provider-schedule/index?id=1&audit=1");
    await page.waitFor(500);
    await capture(miniProgram, "01-default-day-16");
    await miniProgram.pageScrollTo(720);
    await page.waitFor(250);
    await capture(miniProgram, "02-list-lower-and-action");
    page = await miniProgram.reLaunch("/pages/provider-schedule/index?id=1&day=23&audit=1");
    await page.waitFor(500);
    await capture(miniProgram, "03-unknown-day-selected");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
