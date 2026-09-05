const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "S02-COMPOSER");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function shot(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const page = await miniProgram.reLaunch("/pages/provider-profile/index?audit=1&edit=1&section=works");
    await page.waitFor(800);
    await shot(miniProgram, "01-empty-composer");

    await page.setData({
      "selectedWork.imagePreviews": ["/assets/brand/peach-slime-main-768.jpg"],
      "workDrafts[3].imagePreviews": ["/assets/brand/peach-slime-main-768.jpg"]
    });
    await (await page.$('[data-key="title"]')).input("夜航者角色妆造");
    await (await page.$('[data-key="description"]')).input("强化骨相转折与眉眼英气，保留镜头下的皮肤质感。");
    await (await page.$('[data-key="price"]')).input("520");
    await (await page.$('[data-key="subtitle"]')).input("男性角色妆");
    await (await page.$('[data-key="tagsText"]')).input("男角，骨相调整，伤效妆");
    await page.waitFor(220);
    await shot(miniProgram, "02-filled-composer");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
