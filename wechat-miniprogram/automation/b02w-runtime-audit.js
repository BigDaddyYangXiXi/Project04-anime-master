const assert = require("assert");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const storageKey = "v063-followed-providers";

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  const originalFollowedIds = await miniProgram.callWxMethod("getStorageSync", storageKey) || [];
  const runtimeErrors = [];
  miniProgram.on("exception", (error) => runtimeErrors.push(String(error)));

  try {
    const page = await miniProgram.reLaunch("/pages/work-detail/index?id=w-mu-1&audit=1");
    await page.waitFor(500);
    const followButton = await page.$(".follow-button");
    const providerLink = await page.$(".provider-link");
    const codeBar = await page.$(".work-code-bar");
    const copyButton = await page.$(".code-copy-button");
    const figures = await page.$$(".work-figure-card");
    assert.ok(followButton && providerLink, "身份行和关注控件必须可查询");
    assert.ok(codeBar && copyButton, "作品码横栏和复制入口必须可查询");
    assert.ok(figures.length >= 2, "作品详情必须提供至少两张图片以验证连续流");

    const initialFollowed = await page.data("followed");
    await followButton.tap();
    await page.waitFor(150);
    assert.notStrictEqual(await page.data("followed"), initialFollowed, "真实点击必须切换关注状态");
    await followButton.tap();
    await page.waitFor(150);
    assert.strictEqual(await page.data("followed"), initialFollowed, "再次点击必须恢复初始关注状态");

    const providerOffset = await providerLink.offset();
    const providerSize = await providerLink.size();
    const followOffset = await followButton.offset();
    const followSize = await followButton.size();
    const providerCenter = providerOffset.top + providerSize.height / 2;
    const followCenter = followOffset.top + followSize.height / 2;
    assert.ok(Math.abs(providerCenter - followCenter) <= 1, "关注控件与左侧身份行必须共用垂直中心线");
    assert.ok(followSize.width >= 44 && followSize.height >= 44, "关注控件真实热区必须至少 44×44px");
    const codeBarSize = await codeBar.size();
    const copySize = await copyButton.size();
    assert.ok(codeBarSize.width >= 343 && codeBarSize.height >= 48, "作品码横栏必须保持完整横向组件身份");
    assert.ok(copySize.width >= 44 && copySize.height >= 44, "复制入口真实热区必须至少 44×44px");

    const firstOffset = await figures[0].offset();
    const firstSize = await figures[0].size();
    const secondOffset = await figures[1].offset();
    const secondSize = await figures[1].size();
    const lastOffset = await figures[figures.length - 1].offset();
    const lastSize = await figures[figures.length - 1].size();
    const codeBarOffset = await codeBar.offset();
    const systemInfo = await miniProgram.systemInfo();
    assert.strictEqual(firstOffset.left, 0, "首张作品图片必须贴齐左侧视口");
    assert.strictEqual(firstSize.width, systemInfo.windowWidth, "首张作品图片必须占满视口宽度");
    assert.strictEqual(secondOffset.left, 0, "第二张作品图片必须贴齐左侧视口");
    assert.strictEqual(secondSize.width, systemInfo.windowWidth, "第二张作品图片必须占满视口宽度");
    assert.ok(Math.abs(secondOffset.top - (firstOffset.top + firstSize.height)) <= 1, "相邻作品图片之间不得存在纵向间隔");
    assert.ok(codeBarOffset.top >= lastOffset.top + lastSize.height - 1, "作品码横栏必须位于完整图片流之后，而不是标题区或图片中间");
    assert.deepStrictEqual(runtimeErrors, [], "关注切换和图片流检查不得产生运行时异常");
    process.stdout.write("B02W runtime audit: work-code bar, follow toggle, row alignment, 44px targets, full-width seamless gallery, and runtime errors passed\n");
  } finally {
    await miniProgram.callWxMethod("setStorageSync", storageKey, originalFollowedIds);
    miniProgram.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
