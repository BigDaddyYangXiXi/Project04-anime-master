const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const output = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "M01-linked");
const routes = [
  ["01-account", "/pages/account-profile/index?role=provider&audit=1"],
  ["02-assets", "/pages/me-assets/index?type=referenced"],
  ["03-funds", "/pages/funds/index"],
  ["04-work-editor", "/pages/provider-profile/index?edit=1&section=works"]
];

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const exceptions = [];
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  miniProgram.on("exception", (error) => exceptions.push(String(error)));
  try {
    for (const [name, url] of routes) {
      const page = await miniProgram.reLaunch(url);
      await page.waitFor(450);
      await miniProgram.screenshot({ path: path.join(output, `${name}.png`) });
      process.stdout.write(`${name} ${page.path}\n`);
    }
  } finally {
    miniProgram.disconnect();
  }
  if (exceptions.length) throw new Error(exceptions.join("\n"));
}

main().catch((error) => { console.error(error); process.exit(1); });
