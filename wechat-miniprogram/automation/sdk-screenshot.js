const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const cliPath = process.env.WECHAT_CLI_PATH;
const projectPath = path.resolve(__dirname, "..");
const outputPath = path.resolve(process.argv[2] || "sdk-screenshot.png");
const route = process.argv[3] || "/pages/discover/index";

function withTimeout(promise, label, timeout = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout`)), timeout))
  ]);
}

async function main() {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const miniProgram = await withTimeout(
    cliPath ? automator.launch({ cliPath, projectPath }) : automator.connect({ wsEndpoint }),
    "connect",
    30000
  );
  try {
    await withTimeout(miniProgram.reLaunch(route), "route");
    await withTimeout(miniProgram.screenshot({ path: outputPath }), "screenshot");
    process.stdout.write(`${outputPath}\n`);
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
