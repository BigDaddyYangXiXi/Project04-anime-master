const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const automator = require("miniprogram-automator");

const envId = "quest-band-d1gem4bxt3fa17720";
require("./assert-audit-environment")("wx57412ad07a806b70", envId);
const outputPath = path.resolve(__dirname, "..", ".artifacts", "cloudbase-order-runtime.json");

async function call(miniProgram, name, data) {
  return miniProgram.evaluate(function callCloudFunction(env, functionName, payload) {
    wx.cloud.init({ env, traceUser: true });
    return wx.cloud.callFunction({ name: functionName, data: payload }).then((response) => response.result);
  }, envId, name, data);
}

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422" });
  try {
    const account = await call(miniProgram, "account-bootstrap", {});
    assert.equal(account.ok, true, JSON.stringify(account.error));
    const listed = await call(miniProgram, "order-api", { action: "listOrders" });
    assert.equal(listed.ok, true, JSON.stringify(listed.error));
    assert.deepEqual(listed.data.orders, []);

    const rejected = await call(miniProgram, "order-api", {
      action: "createOrder", ndaRequired: false,
      providerId: account.data.account.id,
      serviceIds: ["service_qa"],
      city: "杭州", cityCode: "330100",
      location: "待沟通",
      requirement: "验证同一账号不能向自己创建预约订单",
      timeSegments: [{ startsAt: Date.now() + 86400000, endsAt: Date.now() + 90000000 }],
      contact: { name: "QA", wechat: "qa_contact" },
      idempotencyKey: "runtime-self-order-0001"
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "SELF_ORDER_NOT_ALLOWED");

    const invalidTime = await call(miniProgram, "order-api", {
      action: "createOrder", ndaRequired: false,
      providerId: account.data.account.id,
      serviceIds: ["service_qa"],
      city: "杭州", cityCode: "330100",
      location: "待沟通",
      requirement: "验证服务端拒绝已经过去的预约时间",
      timeSegments: [{ startsAt: Date.now() - 7200000, endsAt: Date.now() - 3600000 }],
      contact: { name: "QA", wechat: "qa_contact" },
      idempotencyKey: "runtime-invalid-time-0001"
    });
    assert.equal(invalidTime.ok, false);
    assert.equal(invalidTime.error.code, "INVALID_TIME_SEGMENTS");

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({
      checkedAt: new Date().toISOString(), orderCount: listed.data.orders.length,
      selfOrderGate: rejected.error.code, invalidTimeGate: invalidTime.error.code, writesPerformed: false
    }, null, 2)}\n`);
    console.log("CloudBase order runtime audit passed: empty list, self-order and server-time gates, no writes");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
