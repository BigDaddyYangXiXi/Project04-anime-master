const assert = require("assert");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    let page = await miniProgram.reLaunch("/pages/provider-profile/index?audit=1&edit=1&section=profile");
    await page.waitFor(700);
    const cards = await page.$$(".portfolio-work");
    assert.ok(cards.length >= 3, "服务橱窗再次进入后必须继续渲染全部作品集");
    const workId = await cards[0].attribute("data-id");
    await page.callMethod("openWorkEditor", { currentTarget: { dataset: { id: workId } } });
    await new Promise((resolve) => setTimeout(resolve, 3500));
    page = await miniProgram.currentPage();
    assert.strictEqual(page.path, "pages/provider-profile/index", "点击作品卡必须进入作品编辑页");
    assert.strictEqual(page.query.section, "works");
    assert.strictEqual(page.query.workId, workId);
    page = await miniProgram.navigateBack();
    await page.waitFor(500);
    assert.strictEqual(page.query.section, "profile", "作品编辑返回后必须回到原橱窗编辑页");
    assert.strictEqual((await page.$$(".portfolio-work")).length, cards.length, "返回后作品集不得消失");
    process.stdout.write("S02 portfolio navigation and return-refresh audit passed\n");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
