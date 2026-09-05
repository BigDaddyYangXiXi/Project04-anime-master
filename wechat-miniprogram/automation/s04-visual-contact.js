const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "S04");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function shot(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/provider-request/index?id=AM-260818-03&audit=1");
    await page.waitFor(350);
    await shot(miniProgram, "03-contact-top");
    await miniProgram.pageScrollTo(700);
    await page.waitFor(150);
    await shot(miniProgram, "04-contact-disabled");

    page = await miniProgram.reLaunch("/pages/provider-request/index?id=AM-260818-03&audit=1&quote=invalid");
    await page.waitFor(350);
    await miniProgram.pageScrollTo(700);
    await page.waitFor(150);
    await shot(miniProgram, "04b-contact-price-invalid");
    page = await miniProgram.reLaunch("/pages/provider-request/index?id=AM-260818-03&audit=1&quote=valid");
    await page.waitFor(350);
    await miniProgram.pageScrollTo(700);
    await page.waitFor(150);
    await shot(miniProgram, "04c-contact-price-valid");

    page = await miniProgram.reLaunch("/pages/provider-request/index?id=AM-260818-03&audit=1&ready=1");
    await page.waitFor(350);
    await miniProgram.pageScrollTo(700);
    await page.waitFor(150);
    await shot(miniProgram, "05-contact-ready");
  } finally {
    await miniProgram.reLaunch("/pages/discover/index");
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
