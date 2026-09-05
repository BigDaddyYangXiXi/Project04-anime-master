const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B02");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function capture(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/provider-detail/index?id=1");
    await page.waitFor(500);
    await capture(miniProgram, "01-profile-top");
    await miniProgram.pageScrollTo(300);
    await page.waitFor(250);
    await capture(miniProgram, "02-services-default");
    page = await miniProgram.reLaunch("/pages/provider-detail/index?id=1&services=makeup%2Cmakeup-follow&expanded=makeup");
    await page.waitFor(500);
    await miniProgram.pageScrollTo(300);
    await page.waitFor(250);
    await capture(miniProgram, "03-services-multi-expanded");
    await miniProgram.pageScrollTo(720);
    await page.waitFor(250);
    await capture(miniProgram, "04-notice-review-schedule");
    await miniProgram.pageScrollTo(9999);
    await page.waitFor(250);
    await capture(miniProgram, "05-portfolio-and-action");
    page = await miniProgram.reLaunch("/pages/provider-detail/index?id=1&services=none");
    await page.waitFor(400);
    await capture(miniProgram, "06-disabled-action");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
