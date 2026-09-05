const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "miniprogram");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const buyer = read("pages/orders/index.wxml");
const provider = read("pages/provider-orders/index.wxml");
const buyerStyle = read("pages/orders/index.wxss");
const providerStyle = read("pages/provider-orders/index.wxss");
const app = read("app.json");
const detail = read("pages/order-detail/index.wxml");
const fulfillment = read("pages/fulfillment/index.wxml");
assert.strictEqual(buyerStyle.trim(), '@import "../../styles/order-list.wxss";');
assert.strictEqual(providerStyle.trim(), '@import "../../styles/order-list.wxss";');
assert.ok(!app.includes("buyer-order-list") && !app.includes("provider-order-list"), "不得保留重复订单列表页");
for (const wxml of [buyer, provider]) {
  assert.ok(wxml.includes("flow-tabs") && wxml.includes("order-list") && wxml.includes("order-row"), "订单根页必须直接显示三标签连续列表");
  assert.ok(wxml.includes("counterpart.nickname") && wxml.includes("counterpart.uid"), "双端列表必须显示对方昵称与 UID");
  assert.ok(wxml.includes("item.city") && wxml.includes("item.scheduleLines"), "三类订单必须共用地点与结构化时间字段");
}
for (const wxml of [detail, fulfillment]) {
  assert.ok(wxml.includes("order-fact-stack") && wxml.includes('class="order-fact-number">1'), "执行与历史详情必须复用编号合作事实组件");
  assert.ok(wxml.includes("地点与时间") && wxml.includes("服务内容") && wxml.includes("合作金额"), "详情事实顺序必须与预约确认一致");
}
process.stdout.write("Root order list and detail visual contract audit: 14 assertions passed\n");
