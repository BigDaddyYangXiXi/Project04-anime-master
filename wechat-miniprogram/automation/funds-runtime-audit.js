const assert = require("assert");
const automator = require("miniprogram-automator");

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  const runtimeErrors = [];
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));
  try {
    const page = await miniProgram.reLaunch("/pages/funds/index");
    for (let attempt = 0; attempt < 30 && await page.data("loading"); attempt++) await page.waitFor(250);
    assert.strictEqual(page.path, "pages/funds/index");
    assert.strictEqual(await page.data("loading"), false, "资金记录读取超时");
    assert.ok(await page.data("loaded") || await page.data("loadError"), "读取结果必须明确区分成功和失败");
    const card = await page.$(".balance-card");
    assert.ok(card, "资金页最上方必须显示结算状态卡");
    const buttons = await card.$$("button");
    assert.strictEqual(buttons.length, 0, "未开通结算时不显示虚假充值和提现入口");
    assert.ok((await page.data("settlementCopy")).includes("不代表已结算"));
    assert.deepStrictEqual(runtimeErrors, []);
    process.stdout.write(`Funds current-state runtime audit passed: ${await page.data("loaded") ? "records read" : "visible read error"}; full state matrix still required\n`);
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
