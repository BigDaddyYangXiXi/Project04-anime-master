const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B01");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function capture(miniProgram, name) {
  const outputPath = path.join(outputDir, `${name}.png`);
  await miniProgram.screenshot({ path: outputPath });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const systemInfo = await miniProgram.systemInfo();
    process.stdout.write(`viewport:${systemInfo.windowWidth}x${systemInfo.windowHeight} pixelRatio=${systemInfo.pixelRatio}\n`);
    let page = await miniProgram.reLaunch("/pages/discover/index");
    await page.waitFor(600);
    await capture(miniProgram, "01-default-makeup-works");

    const careers = ["毛娘", "摄影", "后期"];
    for (let index = 0; index < careers.length; index += 1) {
      page = await miniProgram.reLaunch(`/pages/discover/index?career=${encodeURIComponent(careers[index])}`);
      await page.waitFor(250);
      await capture(miniProgram, `0${index + 2}-career-${careers[index]}`);
    }

    page = await miniProgram.reLaunch("/pages/discover/index?mode=people");
    await page.waitFor(400);
    await capture(miniProgram, "05-people");
    await miniProgram.pageScrollTo(220);
    await page.waitFor(250);
    await capture(miniProgram, "05b-people-complete-card");

    page = await miniProgram.reLaunch("/pages/discover/index");
    await page.waitFor(300);
    const searchTrigger = await page.$(".career-search");
    if (!searchTrigger) throw new Error("B01 search trigger not found");
    await searchTrigger.tap();
    await page.waitFor(200);
    await capture(miniProgram, "06-search-overlay");

    page = await miniProgram.reLaunch("/pages/discover/index?overlay=filter");
    await page.waitFor(200);
    await capture(miniProgram, "07-filter-default");
    page = await miniProgram.reLaunch(`/pages/discover/index?overlay=filter&filterDraft=${encodeURIComponent("男角")}`);
    await page.waitFor(150);
    await capture(miniProgram, "08-filter-selected");

    page = await miniProgram.reLaunch("/pages/discover/index");
    await page.waitFor(300);
    await miniProgram.pageScrollTo(520);
    await page.waitFor(250);
    await capture(miniProgram, "09-sticky-scrolled");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
