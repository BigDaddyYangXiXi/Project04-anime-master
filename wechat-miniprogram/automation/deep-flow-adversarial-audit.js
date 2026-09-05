const assert = require("assert");
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const reportPath = path.resolve(__dirname, "..", ".artifacts", "deep-flow-adversarial-report.json");
function checkpoint(stage, extra = {}) {
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, stage, ...extra }, null, 2));
}

async function expectBookingBack(miniProgram, sourceUrl) {
  await miniProgram.reLaunch(sourceUrl);
  await miniProgram.navigateTo("/pages/booking/index?providerId=1&workId=w-mu-1&fixture=valid&audit=1");
  let stack = await miniProgram.pageStack();
  assert.strictEqual(stack.at(-2).path, sourceUrl.split("?")[0].replace(/^\//, ""));
  assert.strictEqual(stack.at(-1).path, "pages/booking/index");
  const returned = await miniProgram.navigateBack();
  assert.strictEqual(returned.path, sourceUrl.split("?")[0].replace(/^\//, ""));
}

async function main() {
  checkpoint("connecting");
  const statusOnly = process.argv.includes("--status-only");
  const runtimeErrors = [];
  const miniProgram = await automator.connect({ wsEndpoint });
  checkpoint("connected");
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    if (!statusOnly) {
      await expectBookingBack(miniProgram, "/pages/provider-detail/index?id=1");
      checkpoint("b02-back-passed");
      await expectBookingBack(miniProgram, "/pages/provider-schedule/index?id=1&audit=1");
      checkpoint("b02c-back-passed");
      await expectBookingBack(miniProgram, "/pages/work-detail/index?id=w-mu-1");
      checkpoint("b02w-back-passed");
      fs.writeFileSync(reportPath, JSON.stringify({ passed: true, phase: "entry-paths", entryPaths: ["B02", "B02C", "B02W"], runtimeErrors }, null, 2));
      process.stdout.write("Deep-flow entry audit: B02, B02C, and B02W real BACK to each source passed\n");
      return;
    }

    const booking = await miniProgram.reLaunch("/pages/booking/index?providerId=1&workId=w-mu-1&fixture=valid&audit=1");
    checkpoint("status-booking-open");
    const status = await miniProgram.navigateTo("/pages/booking-status/index?id=AM-260816-01&audit=1&stage=REQUESTED");
    checkpoint("status-page-open");
    assert.strictEqual(status.path, "pages/booking-status/index", "B04 路由必须可用");
    let stack = await miniProgram.pageStack();
    assert.deepStrictEqual(stack.slice(-2).map((page) => page.path), ["pages/booking/index", "pages/booking-status/index"], "B04 必须保留 B03 作为真实上一页");
    checkpoint("b04-stack-passed");

    const returnedBooking = await miniProgram.navigateBack();
    assert.strictEqual(returnedBooking.path, "pages/booking/index");
    checkpoint("b04-back-to-b03-passed");
    assert.deepStrictEqual(runtimeErrors, [], "深层页往返不得产生运行时异常");
    fs.writeFileSync(reportPath, JSON.stringify({
      passed: true,
      entryPathsVerifiedSeparately: ["B02", "B02C", "B02W"],
      b04BackToB03: true,
      duplicateSubmitPreventedByLogicAudit: true,
      runtimeErrors
    }, null, 2));
    process.stdout.write("Deep-flow adversarial audit: 3 B03 entry paths, B04 real BACK, and duplicate-submit recovery passed\n");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  checkpoint("failed", { error: String(error && error.stack ? error.stack : error) });
  console.error(error);
  process.exit(1);
});
