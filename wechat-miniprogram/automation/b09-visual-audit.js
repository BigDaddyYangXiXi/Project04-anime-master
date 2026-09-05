const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");
const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B09");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
async function open(miniProgram, route) { const page = await miniProgram.reLaunch(route); await page.waitFor(450); return page; }
async function shot(miniProgram, name) { await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) }); process.stdout.write(`${name}\n`); }
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    const page = await open(miniProgram, "/pages/brief/index?id=PJ-DEMO-0822&audit=1");
    await page.setData({ targetImages: [] });
    await shot(miniProgram, "01-derived-information-top");
    await miniProgram.pageScrollTo(1000); await page.waitFor(200); await shot(miniProgram, "02-empty-target-images");
    await page.setData({ targetImages: [
      "/assets/careers/zhuangniang.png",
      "/assets/careers/sheying.png",
      "/assets/careers/houqi.png",
      "/assets/careers/maoniang.png",
      "/assets/careers/zhuangniang.png",
      "/assets/careers/sheying.png"
    ] });
    await miniProgram.pageScrollTo(1800); await page.waitFor(200); await shot(miniProgram, "03-six-target-images-and-save");
  } finally { miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
