const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputDir = path.resolve(__dirname, "..", ".artifacts", "visual-audit");
const captureScript = path.resolve(__dirname, "capture-devtools.ps1");
const routes = [
  ["B01", "/pages/discover/index"],
  ["B03", "/pages/booking/index?providerId=1&workId=w-mu-1&audit=1"],
  ["B05", "/pages/orders/index"],
  ["B08", "/pages/project-detail/index?id=PJ-DEMO-0822"],
  ["B10", "/pages/fulfillment/index?id=AM-260823-07"],
  ["M01", "/pages/me/index"],
  ["S01", "/pages/provider-home/index"],
  ["S02", "/pages/provider-profile/index"],
  ["S03", "/pages/provider-calendar/index"],
  ["S04", "/pages/provider-request/index?id=AM-260816-01"],
  ["S05", "/pages/provider-task/index?id=AM-260816-01"],
  ["S07", "/pages/provider-reviews/index"]
];

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  const report = [];
  try {
    for (const [id, url] of routes) {
      const page = await Promise.race([
        miniProgram.reLaunch(url),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${id}: route timeout`)), 15000))
      ]);
      await page.waitFor(800);
      const outputPath = path.join(outputDir, `${id}.png`);
      childProcess.execFileSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", captureScript, "-OutputPath", outputPath, "-RightWidth", "760"], { stdio: "pipe" });
      report.push({ id, url, actualPath: page.path, outputPath });
      process.stdout.write(`${id} ${page.path}\n`);
    }
  } finally {
    miniProgram.disconnect();
  }
  fs.writeFileSync(path.join(outputDir, "visual-report.json"), JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
