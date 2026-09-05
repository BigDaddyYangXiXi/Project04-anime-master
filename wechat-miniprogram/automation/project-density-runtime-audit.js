const assert = require("assert");
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const outputDir = path.resolve(__dirname, "..", ".artifacts", "project-density-audit");
const orderKey = "anime-master-v063-orders";
const projectKey = "animeMasterProjects";

function orders() {
  const stages = ["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"];
  return Array.from({ length: 20 }, (_, index) => ({
    id: `AM-DENSITY-${String(index + 1).padStart(2, "0")}`,
    buyerId: "buyer-ayao",
    providerId: index + 1,
    providerUid: `provider-density-${index + 1}`,
    provider: `服务者${index + 1}号长昵称`,
    career: ["妆娘", "摄影", "后期", "毛娘"][index % 4],
    service: `角色服务项目${index + 1}`,
    city: "杭州",
    time: "2026/08/25 08:00—10:00",
    requirement: "20 人项目密度验收",
    reference: "未提供参考资料",
    finalPrice: 520 + index * 10,
    requestedAt: Date.now() - index * 1000,
    stage: stages[index % stages.length]
  }));
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const miniProgram = await automator.connect({ wsEndpoint });
  const originalOrders = await miniProgram.callWxMethod("getStorageSync", orderKey);
  const originalProjects = await miniProgram.callWxMethod("getStorageSync", projectKey);
  try {
    const densityOrders = orders();
    await miniProgram.callWxMethod("setStorageSync", "animeMasterRole", "buyer");
    await miniProgram.callWxMethod("setStorageSync", orderKey, densityOrders);
    await miniProgram.callWxMethod("setStorageSync", projectKey, [{
      id: "PJ-DENSITY", title: "二十人群像项目", shortTitle: "二十人群像项目", date: "2026-08-25", city: "杭州",
      location: "杭州 · 具体地点待确认", description: "用于验证二十人项目订单密度。",
      bookingIds: densityOrders.map((item) => item.id), projectModelVersion: 2, briefSaved: true
    }]);
    const page = await miniProgram.reLaunch("/pages/project-detail/index?id=PJ-DENSITY&audit=1");
    await page.waitFor(350);
    const rows = await page.$$(".role-row");
    assert.strictEqual(rows.length, 20, "20 条关联订单必须全部渲染");
    const viewportHeight = (await miniProgram.systemInfo()).windowHeight;
    const geometry = await Promise.all(rows.map(async (row) => ({ offset: await row.offset(), size: await row.size() })));
    const visible = geometry.filter(({ offset, size }) => offset.top < viewportHeight - 70 && offset.top + size.height > 0);
    assert.ok(visible.length >= 6, `首屏至少应看到 6 条订单，当前 ${visible.length} 条`);
    assert.ok(Math.max(...geometry.map(({ size }) => size.height)) <= 60, "单笔订单行高度不得超过 60px");
    await miniProgram.screenshot({ path: path.join(outputDir, "01-twenty-orders-top.png") });
    await miniProgram.pageScrollTo(900);
    await page.waitFor(180);
    await miniProgram.screenshot({ path: path.join(outputDir, "02-twenty-orders-scroll.png") });
    process.stdout.write(`Project density runtime audit passed: ${visible.length} rows visible in first viewport\n`);
  } finally {
    await miniProgram.callWxMethod("setStorageSync", orderKey, originalOrders || []);
    await miniProgram.callWxMethod("setStorageSync", projectKey, originalProjects || []);
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
