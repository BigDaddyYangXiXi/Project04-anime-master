const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B03");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function capture(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function open(miniProgram, route, wait = 450) {
  const page = await miniProgram.reLaunch(route);
  await page.waitFor(wait);
  return page;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await open(miniProgram, "/pages/booking/index?providerId=1&workId=w-mu-1&audit=1");
    await capture(miniProgram, "01-continuous-default-top");
    await miniProgram.pageScrollTo(520); await page.waitFor(200); await capture(miniProgram, "02-services-and-contact");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&workId=w-mu-1&services=makeup%2Cmakeup-follow&audit=1");
    await miniProgram.pageScrollTo(520); await page.waitFor(200);
    await capture(miniProgram, "02a-service-selected-stable");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&mode=day&audit=1");
    await capture(miniProgram, "03-all-day-mode");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&mode=multi-day&audit=1");
    await capture(miniProgram, "04-continuous-cross-day-compat");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&mode=segments&audit=1");
    await capture(miniProgram, "05-segments-mode");
    await miniProgram.pageScrollTo(520); await page.waitFor(200); await capture(miniProgram, "05b-segments-add-control");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&workId=w-mu-1&fixture=valid&conflict=1&audit=1");
    await capture(miniProgram, "06-full-day-conflict");
    const conflictSubmit = await page.$(".primary-block"); await conflictSubmit.tap(); await page.waitFor(150);
    await miniProgram.pageScrollTo(2200); await page.waitFor(250); await capture(miniProgram, "06b-conflict-message-disabled");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&mode=continuous&invalid=1&audit=1");
    const invalidSubmit = await page.$(".primary-block"); await invalidSubmit.tap(); await page.waitFor(150);
    await capture(miniProgram, "06c-continuous-invalid");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&workId=w-mu-1&fixture=valid&audit=1");
    await miniProgram.pageScrollTo(1500); await page.waitFor(250); await capture(miniProgram, "07-work-reference-valid");
    page = await open(miniProgram, "/pages/booking/index?providerId=1&fixture=valid&reference=file&audit=1");
    await miniProgram.pageScrollTo(1500); await page.waitFor(250); await capture(miniProgram, "08-file-reference-valid");
    process.stdout.write("B03 service-price before/after screenshots captured for geometry comparison\n");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
