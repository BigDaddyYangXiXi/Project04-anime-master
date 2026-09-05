const automator = require("miniprogram-automator");
const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const page = await miniProgram.reLaunch("/pages/project-detail/index?id=PJ-DEMO-0822");
    await page.waitFor(200);
    const component = await page.$(".app-navigation");
    const back = await component.$(".app-back");
    const navOffset = await component.offset();
    const navSize = await component.size();
    const backOffset = await back.offset();
    const backSize = await back.size();
    const chevron = await component.$(".back-chevron");
    const chevronOffset = await chevron.offset();
    const chevronSize = await chevron.size();
    process.stdout.write(`${JSON.stringify({ navOffset, navSize, backOffset, backSize, chevronOffset, chevronSize, absoluteLeft: navOffset.left + backOffset.left })}\n`);
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
