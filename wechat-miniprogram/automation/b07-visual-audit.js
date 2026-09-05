const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B07");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const page = await miniProgram.reLaunch("/pages/projects/index");
    await page.waitFor(450);
    await miniProgram.screenshot({ path: path.join(outputDir, "01-project-list.png") });
    process.stdout.write("01-project-list\n");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
