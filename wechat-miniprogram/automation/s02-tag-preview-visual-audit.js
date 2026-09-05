const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "S02-TAGS");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function captureNear(page, miniProgram, element, name) {
  await miniProgram.pageScrollTo(0);
  await page.waitFor(120);
  const offset = await element.offset();
  await miniProgram.pageScrollTo(Math.max(0, offset.top - 420));
  await page.waitFor(220);
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/provider-profile/index?audit=1&edit=1");
    await page.waitFor(500);
    const compactInputs = await page.$$(".compact-field input");
    await compactInputs[compactInputs.length - 1].input("男角，骨相调整,男角");
    await page.waitFor(180);
    let previews = await page.$$(".tag-preview");
    await captureNear(page, miniProgram, previews[0], "01-profile-tags");
    page = await miniProgram.reLaunch("/pages/provider-profile/index?audit=1&edit=1&section=works&workId=w-mu-1");
    await page.waitFor(1000);
    const workTagInput = await page.$('input[data-key="tagsText"]');
    await workTagInput.input("男角,骨相调整，男角");
    await page.waitFor(180);
    previews = await page.$$(".tag-preview");
    await captureNear(page, miniProgram, previews[0], "02-work-tags");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
