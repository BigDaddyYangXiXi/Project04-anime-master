const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "PAGE-DESCRIPTIONS");
const routes = [
  ["B01", "/pages/discover/index"],
  ["B02W", "/pages/work-detail/index?id=w-mu-1"],
  ["B03", "/pages/booking/index?providerId=1&workId=w-mu-1&audit=1"],
  ["B07", "/pages/projects/index"],
  ["B08", "/pages/project-detail/index?id=PJ-DEMO-0822"],
  ["B09", "/pages/brief/index?id=PJ-DEMO-0822"],
  ["B10", "/pages/fulfillment/index?id=AM-260823-07"],
  ["M01-buyer", "/pages/me/index?audit=1&role=buyer"],
  ["M01-provider", "/pages/me/index?audit=1&role=provider"],
  ["S01", "/pages/provider-home/index"],
  ["S02", "/pages/provider-profile/index?edit=1&section=profile"],
];

function withTimeout(promise, label, timeout = 12000) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeout}ms`)), timeout);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const runtimeErrors = [];
  const miniProgram = await withTimeout(automator.connect({ wsEndpoint }), "connect");
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    for (const [name, route] of routes) {
      const page = await withTimeout(miniProgram.reLaunch(route), `${name} reLaunch`);
      await page.waitFor(450);
      await withTimeout(miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) }), `${name} screenshot`, 20000);
      process.stdout.write(`${name}\n`);
    }
  } finally {
    miniProgram.disconnect();
  }
  if (runtimeErrors.length) throw new Error(runtimeErrors.join("\n"));
  process.stdout.write(`Page-description visual audit passed: ${routes.length} affected states\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
