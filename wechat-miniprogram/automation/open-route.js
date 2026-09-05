const automator = require("miniprogram-automator");

async function main() {
  const url = process.argv[2];
  const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
  if (!url) throw new Error("请提供页面路由");
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const page = await Promise.race([
      miniProgram.reLaunch(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("route timeout")), 15000))
    ]);
    if (!page) throw new Error("页面未返回");
    await page.waitFor(800);
    const currentPage = await miniProgram.currentPage();
    if (!currentPage || currentPage.path !== page.path) throw new Error(`当前可见页与目标不一致：${currentPage ? currentPage.path : "none"}`);
    process.stdout.write(currentPage.path);
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
