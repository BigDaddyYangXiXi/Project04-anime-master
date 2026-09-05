const fs = require("fs"); const path = require("path"); const automator = require("miniprogram-automator");
const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B10");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
async function open(miniProgram, route) { const page = await miniProgram.reLaunch(route); await page.waitFor(450); return page; }
async function shot(miniProgram, name) { await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) }); process.stdout.write(`${name}\n`); }
async function main() {
  fs.mkdirSync(outputDir, { recursive: true }); const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await open(miniProgram, "/pages/fulfillment/index?id=AM-260823-07"); await shot(miniProgram, "01-file-delivery-top"); await miniProgram.pageScrollTo(650); await page.waitFor(200); await shot(miniProgram, "02-file-delivery-actions-disabled");
    page = await open(miniProgram, "/pages/fulfillment/index?id=AM-260823-07&audit=1&revision=1"); await miniProgram.pageScrollTo(650); await page.waitFor(200); await shot(miniProgram, "03-file-revision-enabled");
    page = await open(miniProgram, "/pages/fulfillment/index?id=AM-260825-09"); await shot(miniProgram, "04-onsite-top"); await miniProgram.pageScrollTo(600); await page.waitFor(200); await shot(miniProgram, "05-onsite-actions");
    await open(miniProgram, "/pages/fulfillment/index?id=AM-260824-08"); await shot(miniProgram, "06-completed");
    await open(miniProgram, "/pages/fulfillment/index?id=AM-260821-05"); await shot(miniProgram, "07-no-delivery");
  } finally { miniProgram.disconnect(); }
}
main().catch((error) => { console.error(error); process.exit(1); });
