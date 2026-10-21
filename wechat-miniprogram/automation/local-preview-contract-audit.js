const assert = require("node:assert/strict");
const preview = require("../miniprogram/utils/local-preview");

async function main() {
  let platform = "devtools";
  let enabled = false;
  let calls = 0;
  global.wx = {
    getDeviceInfo: () => ({ platform }),
    getStorageSync: () => enabled,
    cloud: { callFunction: async () => { calls++; return { result: { ok: true, data: {} } }; } }
  };
  assert.equal(preview.isLocal(), true);
  enabled = true;
  assert.equal(preview.isAudit({}), true, "详情和 tab 无需携带 audit 参数");
  assert.throws(() => preview.assertCloudAllowed(), { code: "LOCAL_PREVIEW_ONLY" });
  const account = require("../miniprogram/services/cloud-account");
  const orders = require("../miniprogram/services/cloud-orders");
  const saved = require("../miniprogram/services/cloud-saved-items");
  for (const call of [() => account.getMine(), () => orders.listOrders(), () => saved.listMine()]) {
    // Services may reject the disabled connection before checking preview mode.
    await assert.rejects(call, error => ["LOCAL_PREVIEW_ONLY", "CLOUD_UNAVAILABLE"].includes(error.code));
  }
  assert.equal(calls, 0, "本地预览不能请求真实云函数");
  for (platform of ["ios", "android"]) {
    assert.equal(preview.isLocal(), false, "真机不得继承模拟器免登录状态");
    assert.equal(preview.isAudit({}), false);
    assert.doesNotThrow(() => preview.assertCloudAllowed());
  }
  platform = "devtools";
  enabled = false;
  assert.equal(preview.isAudit({}), true, "旧缓存不能重新开启登录拦截");
  global.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: "release" } });
  assert.equal(preview.isLocal(), false, "正式版本保留真实业务分支");
  await assert.rejects(() => account.getMine(), { code: "CLOUD_UNAVAILABLE" });
  assert.equal(calls, 0, "正式版也不能绕过尚未开启的云配置");
  delete global.wx;
  assert.equal(preview.isLocal(), false);
  console.log("Local preview: cross-page context, device isolation and cloud guard passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
