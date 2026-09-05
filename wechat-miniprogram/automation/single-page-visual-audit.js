const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const route = process.argv[2];
const name = process.argv[3];
const scrollTop = Number(process.argv[4] || 0);
const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "DETAIL-SIZE");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

function withTimeout(promise, milliseconds, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function main() {
  if (!route || !name) throw new Error("usage: node single-page-visual-audit.js <route> <name> [scrollTop]");
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await withTimeout(automator.connect({ wsEndpoint }), 12000, "connect");
  try {
    const page = await withTimeout(miniProgram.reLaunch(route), 12000, "reLaunch");
    await page.waitFor(500);
    if (scrollTop) {
      await withTimeout(miniProgram.pageScrollTo(scrollTop), 8000, "pageScrollTo");
      await page.waitFor(250);
    }
    await withTimeout(miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) }), 20000, "screenshot");
    process.stdout.write(`${name}\n`);
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
