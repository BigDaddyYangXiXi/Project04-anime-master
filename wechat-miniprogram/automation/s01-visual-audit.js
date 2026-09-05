const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");
const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "S01");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function shot(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const page = await miniProgram.reLaunch("/pages/provider-home/index");
    await page.waitFor(500);
    await shot(miniProgram, "01-top-and-priority");
    await miniProgram.pageScrollTo(1050);
    await page.waitFor(250);
    await shot(miniProgram, "02-priority-and-overview");
    await miniProgram.pageScrollTo(2400);
    await page.waitFor(250);
    await shot(miniProgram, "03-overview-and-tools");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
