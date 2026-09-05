const fs = require("fs");
const net = require("net");
const automator = require("miniprogram-automator");

const host = "127.0.0.1";
const port = Number(process.env.WECHAT_AUTO_PORT || 9422);
const routeFlag = process.argv.indexOf("--route");
const targetRoute = routeFlag >= 0 ? process.argv[routeFlag + 1] : "";
const cliCandidates = [
  process.env.WECHAT_CLI_PATH,
  "D:\\WeChatmini\\微信web开发者工具\\cli.bat",
  "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
  "C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat"
].filter(Boolean);

function checkPort(timeout = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (healthy) => {
      socket.destroy();
      resolve(healthy);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function withTimeout(promise, label, milliseconds = 3000) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function main() {
  const startedAt = Date.now();
  const listening = await checkPort();
  if (listening) {
    let miniProgram;
    try {
      miniProgram = await withTimeout(automator.connect({ wsEndpoint: `ws://${host}:${port}` }), "connect");
      await withTimeout(miniProgram.systemInfo(), "systemInfo");
      if (targetRoute) await withTimeout(miniProgram.reLaunch(targetRoute), "route", 8000);
      process.stdout.write(`WeChat automation preflight passed: ${host}:${port}${targetRoute ? " route" : " RPC"} responsive (${Date.now() - startedAt}ms)\n`);
      return;
    } catch (error) {
      process.stderr.write(`WeChat automation preflight failed: ${host}:${port} listens but RPC is unhealthy (${error.message})\n`);
    } finally {
      if (miniProgram) miniProgram.disconnect();
    }
  }
  const cliPath = cliCandidates.find((candidate) => fs.existsSync(candidate));
  if (!listening) process.stderr.write(`WeChat automation preflight failed: ${host}:${port} is not listening\n`);
  if (cliPath) process.stderr.write(`CLI found: ${cliPath}\n`);
  else process.stderr.write("CLI not found in configured locations; set WECHAT_CLI_PATH\n");
  process.exitCode = 2;
}

main();
