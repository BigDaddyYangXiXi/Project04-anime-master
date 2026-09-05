const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputPath = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B01", "06-search-overlay.png");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

function withTimeout(promise, milliseconds, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds))
  ]);
}

async function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const miniProgram = await withTimeout(automator.connect({ wsEndpoint }), 12000, "connect");
  try {
    const page = await withTimeout(miniProgram.reLaunch("/pages/discover/index"), 12000, "reLaunch");
    await page.waitFor(400);
    const searchTrigger = await withTimeout(page.$(".career-search"), 5000, "find search trigger");
    if (!searchTrigger) throw new Error("B01 search trigger not found");
    await withTimeout(searchTrigger.tap(), 5000, "tap search trigger");
    await page.waitFor(250);
    const modal = await withTimeout(page.$(".modal-panel"), 5000, "find search modal");
    if (!modal) throw new Error("Search modal did not open after tapping the full search bar");
    await withTimeout(miniProgram.screenshot({ path: outputPath }), 12000, "screenshot");
    process.stdout.write("B01 full-search-bar tap audit passed\n");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
