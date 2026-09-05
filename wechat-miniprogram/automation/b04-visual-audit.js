const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B04");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function capture(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function open(miniProgram, route) {
  const page = await miniProgram.reLaunch(route);
  await page.waitFor(450);
  return page;
}

async function swipeUp(page, times = 1) {
  await page.callMethod("auditScroll", times * 600);
  await page.waitFor(300);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=REQUESTED");
    await capture(miniProgram, "01-requested");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=SUPPLEMENT_REQUESTED");
    await capture(miniProgram, "02-supplement-empty-disabled");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=SUPPLEMENT_REQUESTED&prefill=1");
    await capture(miniProgram, "03-supplement-filled-enabled");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=CONTACTING");
    await capture(miniProgram, "04-accepted-before-copy-step-1");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=CONTACTING&started=1");
    await capture(miniProgram, "05-contact-started-step-2");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=CONTACTING&started=1&segments=1");
    await capture(miniProgram, "05b-contact-step-2-multiple-segments");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=DECLINED");
    await capture(miniProgram, "06-request-declined");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=DECLINED&failure=communication");
    await capture(miniProgram, "07-communication-failed");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=NDA_BUYER_PENDING");
    await capture(miniProgram, "08-step-3-buyer-nda");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=NDA_PROVIDER_PENDING");
    await capture(miniProgram, "09-step-3-provider-nda");
    let page = await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=BUYER_FINAL_CONFIRM");
    await capture(miniProgram, "10-step-3-confirm-agreement");
    await swipeUp(page, 2);
    await capture(miniProgram, "10b-step-3-confirm-agreement-lower");
    page = await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=BUYER_FINAL_CONFIRM&agreement=1");
    await capture(miniProgram, "11-step-3-payment");
    await swipeUp(page, 3);
    await capture(miniProgram, "11b-step-3-payment-lower");
    await open(miniProgram, "/pages/booking-status/index?id=AM-260816-01&audit=1&stage=IN_PRODUCTION&paymentStatus=PAID");
    await capture(miniProgram, "12-step-4-production");
  } finally {
    await miniProgram.reLaunch("/pages/discover/index");
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
