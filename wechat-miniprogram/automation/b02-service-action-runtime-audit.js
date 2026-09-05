const assert = require("assert");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const timeout = (promise, label, milliseconds = 8000) => {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};

async function main() {
  const miniProgram = await timeout(automator.connect({ wsEndpoint }), "connect");
  try {
    const page = await timeout(miniProgram.reLaunch("/pages/provider-detail/index?id=1&services=none&audit=1"), "open unselected state");
    await page.waitFor(400);
    const select = await page.$(".service-select");
    const expand = await page.$(".service-expand");
    assert.ok(select && expand, "选择和详情入口必须同时存在");

    await select.tap();
    await page.waitFor(120);
    assert.strictEqual((await page.data("selectedServiceIds")).length, 1, "选择必须写入已选服务");
    assert.strictEqual((await page.data("provider")).services[0].expanded, false, "选择不得自动展开详情");

    await expand.tap();
    await page.waitFor(120);
    assert.strictEqual((await page.data("selectedServiceIds")).length, 1, "展开详情不得取消选择");
    assert.strictEqual((await page.data("provider")).services[0].expanded, true, "详情入口必须独立展开");

    await expand.tap();
    await page.waitFor(120);
    assert.strictEqual((await page.data("selectedServiceIds")).length, 1, "收起详情仍须保留选择");
    assert.strictEqual((await page.data("provider")).services[0].expanded, false, "详情入口必须可以独立收起");
  } finally {
    miniProgram.disconnect();
  }
  process.stdout.write("B02 service action runtime audit: 7 assertions passed\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
