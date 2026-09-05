const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B02W");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function capture(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/work-detail/index?id=w-mu-1");
    await page.waitFor(500);
    await capture(miniProgram, "01-top-default");
    await miniProgram.pageScrollTo(760);
    await page.waitFor(250);
    await capture(miniProgram, "02-gallery-middle");
    await miniProgram.pageScrollTo(2860);
    await page.waitFor(250);
    await capture(miniProgram, "03-gallery-lower");
    await miniProgram.pageScrollTo(3900);
    await page.waitFor(250);
    await capture(miniProgram, "04-info-and-action");
    page = await miniProgram.reLaunch("/pages/work-detail/index?id=w-mu-1&followed=1");
    await page.waitFor(400);
    await capture(miniProgram, "05-followed-state");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
