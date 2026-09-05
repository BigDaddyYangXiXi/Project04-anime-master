const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "S02-PORTFOLIO-UPLOAD");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function shot(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/provider-profile/index?audit=1&edit=1&section=profile");
    await page.waitFor(500);
    await miniProgram.pageScrollTo(1800);
    await page.waitFor(300);
    await shot(miniProgram, "01-storefront-portfolio-grid");

    const workCards = await page.$$(".portfolio-work");
    if (!workCards.length) throw new Error("作品集双列卡片未渲染");
    const workId = await workCards[0].attribute("data-id");
    page = await miniProgram.reLaunch(`/pages/provider-profile/index?audit=1&edit=1&section=works&workId=${workId}`);
    await page.waitFor(1200);
    await shot(miniProgram, "02-existing-work-editor");

    page = await miniProgram.reLaunch("/pages/provider-profile/index?audit=1&edit=1&section=works");
    await page.waitFor(1200);
    await shot(miniProgram, "03-new-work-image-upload");
    const title = await page.$('[data-key="title"]');
    const description = await page.$('[data-key="description"]');
    const price = await page.$('[data-key="price"]');
    const tags = await page.$('[data-key="tagsText"]');
    await title.input("新作品标题");
    await description.input("这是一段用于验证排版层级的作品描述。");
    await price.input("680");
    await tags.input("男角，骨相调整,男角");
    await miniProgram.pageScrollTo(620);
    await page.waitFor(250);
    await shot(miniProgram, "04-new-work-copy-tags");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
