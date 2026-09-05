const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "S02-COMPACT");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function shot(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const page = await miniProgram.reLaunch("/pages/provider-profile/index?audit=1&edit=1&section=profile");
    await page.waitFor(500);
    await shot(miniProgram, "01-profile-compact");
    await miniProgram.pageScrollTo(560);
    await page.waitFor(250);
    await shot(miniProgram, "02-service-first-expanded");
    const expandControls = await page.$$(".expand-control");
    await expandControls[0].tap();
    await expandControls[1].tap();
    await page.waitFor(250);
    await shot(miniProgram, "03-service-second-expanded");
    const pickerTriggers = await page.$$(".work-picker-trigger");
    await pickerTriggers[0].tap();
    await page.waitFor(250);
    await shot(miniProgram, "04-work-picker");
    const rows = await page.$$(".picker-work-row");
    await rows[0].tap();
    await page.waitFor(150);
    await shot(miniProgram, "05-work-picker-selected");
    const actions = await page.$$(".picker-actions button");
    await actions[1].tap();
    await page.waitFor(250);
    await shot(miniProgram, "06-picker-confirmed");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
