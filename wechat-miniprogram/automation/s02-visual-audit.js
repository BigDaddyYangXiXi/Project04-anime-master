const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");
const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "S02");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
async function shot(miniProgram, name) { await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) }); process.stdout.write(`${name}\n`); }
async function open(miniProgram, route) { const page = await miniProgram.reLaunch(route); await page.waitFor(450); return page; }
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await open(miniProgram, "/pages/provider-profile/index");
    await shot(miniProgram, "01-browse-top");
    await miniProgram.pageScrollTo(650); await page.waitFor(200); await shot(miniProgram, "02-browse-actions");
    page = await open(miniProgram, "/pages/provider-profile/index?audit=1&edit=1");
    await shot(miniProgram, "03-edit-profile");
    await miniProgram.pageScrollTo(900); await page.waitFor(200); await shot(miniProgram, "04-services");
    await miniProgram.pageScrollTo(1900); await page.waitFor(200); await shot(miniProgram, "05-works");
    await miniProgram.pageScrollTo(4100); await page.waitFor(200); await shot(miniProgram, "06-work-editor-actions");
    page = await open(miniProgram, "/pages/provider-profile/index?audit=1&edit=1&twoWorks=1");
    await miniProgram.pageScrollTo(4100); await page.waitFor(200); await shot(miniProgram, "06b-two-works-publish-disabled");
    page = await open(miniProgram, "/pages/provider-profile/index?audit=1&edit=1&invalid=1");
    await miniProgram.pageScrollTo(4100); await page.waitFor(200); await shot(miniProgram, "07-invalid-publish-disabled");
  } finally { miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
