const assert = require("assert");
const automator = require("miniprogram-automator");

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const runtimeErrors = [];
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    const page = await miniProgram.reLaunch("/pages/funds/index");
    await page.waitFor(180);
    assert.strictEqual(page.path, "pages/funds/index");
    assert.strictEqual(await page.data("withdrawableBalance"), "0.00");
    const card = await page.$(".balance-card");
    assert.ok(card, "资金页最上方必须显示可提现余额卡");
    const buttons = await card.$$("button");
    assert.strictEqual(buttons.length, 2, "余额卡必须并列显示提现和充值");
    assert.strictEqual(await buttons[0].text(), "提现");
    assert.strictEqual(await buttons[1].text(), "充值");
    assert.deepStrictEqual(runtimeErrors, []);
    process.stdout.write("Funds runtime audit passed\n");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
