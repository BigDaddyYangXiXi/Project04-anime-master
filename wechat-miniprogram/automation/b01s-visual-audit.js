const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const outputDir = path.resolve(__dirname, "..", ".artifacts", "v063-page-audit", "B01S");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function capture(miniProgram, route, name) {
  const page = await miniProgram.reLaunch(route);
  await page.waitFor(500);
  await miniProgram.screenshot({ path: path.join(outputDir, `${name}.png`) });
  process.stdout.write(`${name}\n`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    await capture(miniProgram, "/pages/search-results/index?career=%E5%A6%86%E5%A8%98&city=%E6%9D%AD%E5%B7%9E", "01-default-results");
    await capture(miniProgram, "/pages/search-results/index?career=%E5%A6%86%E5%A8%98&city=%E6%9D%AD%E5%B7%9E&filters=%E7%94%B7%E8%A7%92", "02-filter-tag-results");
    await capture(miniProgram, "/pages/search-results/index?career=%E6%91%84%E5%BD%B1&city=%E6%9D%AD%E5%B7%9E&q=%E5%A4%9C%E6%99%AF", "03-query-results");
    await capture(miniProgram, "/pages/search-results/index?career=%E6%91%84%E5%BD%B1&city=%E6%9D%AD%E5%B7%9E&q=%E4%B8%8D%E5%AD%98%E5%9C%A8", "04-empty-results");
    await capture(miniProgram, "/pages/search-results/index?career=%E6%91%84%E5%BD%B1&city=%E6%9D%AD%E5%B7%9E&overlay=search", "05-search-overlay");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
