const assert = require("assert");
const fs = require("fs");
const path = require("path");

const pageRoot = path.resolve(__dirname, "..", "miniprogram", "pages", "booking-status");
const js = fs.readFileSync(path.join(pageRoot, "index.js"), "utf8");
const wxml = fs.readFileSync(path.join(pageRoot, "index.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(pageRoot, "index.wxss"), "utf8");
const machine = fs.readFileSync(path.resolve(__dirname, "../miniprogram/data/order-machine.js"), "utf8");
const payment = fs.readFileSync(path.resolve(__dirname, "../miniprogram/data/payment-gateway.js"), "utf8");
const providerWxml = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/provider-request/index.wxml"), "utf8");
const orderDetail = fs.readFileSync(path.resolve(__dirname, "../miniprogram/pages/order-detail/index.js"), "utf8");

for (const label of ["预约沟通发起", "完成预约沟通", "合作确立确认", "执行制作"]) assert.ok(js.includes(label), `缺少四步节点：${label}`);
assert.ok(js.includes('order.stage === "CONTACTING" && Number.isFinite(order.contactFirstCopiedAt)'), "第2步必须由沟通阶段与首次复制事实共同判定");
assert.ok(wxml.includes("你需要做") && wxml.includes("对方需要做") && wxml.includes("下一步"), "第1、2步必须明确双方动作和下一步");
assert.ok(wxml.includes("双方与预约信息") && wxml.includes("服务内容与需求") && wxml.includes("服务方提交的确认"), "第3步必须分组呈现完整合作事实");
for (const label of ["地点与时间确认", "服务内容确认", "保密需求确认", "合作金额确认"]) assert.ok(wxml.includes(label), `第3步缺少服务方确认项：${label}`);
assert.ok(wxml.includes("order.requirement") && wxml.includes("order.reference") && wxml.includes("buyerIdentity.nickname") && wxml.includes("providerIdentity.uid"), "第3步必须保留原始需求、参考及双方昵称和 UID");
assert.ok(payment.includes("wx.requestPayment") && payment.includes("PAYMENT_NOT_CONFIGURED"), "支付必须调用微信原生能力并显式处理未配置状态");
assert.ok(machine.includes('BUYER_FINAL_CONFIRM: { PAYMENT_VERIFIED: "IN_PRODUCTION" }') && !machine.includes("BUYER_CONFIRMS_EXECUTION"), "未核验支付不得进入制作");
assert.ok(js.includes('paymentStatus === "PAID"') && js.includes('"PAYMENT_VERIFIED"'), "第4步必须由服务端已支付事实驱动");
assert.ok(providerWxml.includes("你的页面仍停留在此处继续填写结果"), "联系方式首次复制后服务方页面必须保持在预约请求页");
assert.ok(orderDetail.includes("goBookingStatus") && !orderDetail.includes("BUYER_CONFIRMS_EXECUTION"), "订单详情不得绕过预约状态页确认并进入制作");
assert.ok(/\.journey-list[^}]*background:\s*#fffaf8/.test(wxss) && /\.journey-node[^}]*grid-template-columns:\s*38rpx minmax\(0, 1fr\)/.test(wxss), "四步进度必须统一使用竖向四节点轨道");
assert.ok(!wxml.includes('class="journey-strip"'), "任何步骤不得回退为横向进度轨道");
assert.ok(/\.primary-block[^}]*box-shadow:\s*none/.test(wxss) && /\.text-action[^}]*box-shadow:\s*none/.test(wxss), "重要按钮不得使用投影");
assert.ok(!/class="role-row|class="role-list/.test(wxml), "旧的两列信息表结构不得残留");

process.stdout.write("B04 four-step UI contract audit: 24 assertions passed\n");
