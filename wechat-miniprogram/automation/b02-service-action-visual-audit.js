const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B02-service-actions");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const timeout = (promise, label, milliseconds = 8000) => {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};

async function capture(miniProgram, name) {
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const state = (process.argv.find((argument) => argument.startsWith("--state=")) || "--state=unselected").split("=")[1];
  const target = { route: "/pages/provider-detail/index?id=1&services=none", name: state === "selected" ? "02-selected-and-expanded" : "01-unselected" };
  const miniProgram = await timeout(automator.connect({ wsEndpoint }), "connect");
  try {
    const page = await timeout(miniProgram.reLaunch(target.route), `open ${state} state`);
    await page.waitFor(300);
    if (state === "selected") {
      const selects = await page.$$(".service-select");
      const expands = await page.$$(".service-expand");
      if (selects.length < 2 || !expands[0]) throw new Error("service action controls missing");
      await selects[0].tap();
      await selects[1].tap();
      await expands[0].tap();
      await page.waitFor(150);
    }
    await miniProgram.pageScrollTo(300);
    await capture(miniProgram, target.name);
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
