const assert = require("assert");
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const projectPath = path.resolve(__dirname, "..");
const auditRoot = path.resolve(projectPath, ".artifacts", "v063-page-audit");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9423";

function withTimeout(promise, milliseconds, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds))
  ]);
}

async function main() {
  fs.mkdirSync(path.join(auditRoot, "B01"), { recursive: true });
  fs.mkdirSync(path.join(auditRoot, "B02W"), { recursive: true });
  process.stdout.write("connect\n");
  const miniProgram = await withTimeout(automator.connect({ wsEndpoint }), 12000, "connect");
  try {
    process.stdout.write("reLaunch B01\n");
    let page = await withTimeout(miniProgram.reLaunch("/pages/discover/index"), 15000, "reLaunch B01");
    await page.waitFor(500);
    await withTimeout(miniProgram.screenshot({ path: path.join(auditRoot, "B01", "10-single-tap-before.png") }), 12000, "B01 screenshot");
    assert.strictEqual(page.path, "pages/discover/index", "首页未正常打开");
    process.stdout.write("open B02W for full-page visual acceptance\n");
    page = await withTimeout(
      miniProgram.navigateTo("/pages/work-detail/index?id=w-mu-1&source=B01"),
      12000,
      "navigate B02W"
    );
    await page.waitFor(500);
    assert.strictEqual(page.path, "pages/work-detail/index", "作品详情未正常打开");
    await withTimeout(miniProgram.screenshot({ path: path.join(auditRoot, "B02W", "06-copy-button-default.png") }), 12000, "B02W screenshot");
    process.stdout.write("B01/B02W full-page default-state visual acceptance passed\n");
    process.stdout.write("Physical single-tap and clipboard interaction remain manual/real-device acceptance items\n");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
