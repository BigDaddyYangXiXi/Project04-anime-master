const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const envId = require("../miniprogram/config/cloudbase").env;
const appId = require("../project.config.json").appid;
assert.ok(envId, "CloudBase environment must be configured for the runtime audit");
assert.equal(envId, require("../cloudbaserc.json").envId, "Runtime and deployment targets must match");

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const result = await miniProgram.evaluate(function callAuthProbe(target) {
      const account = wx.getAccountInfoSync();
      if (!account.miniProgram || account.miniProgram.appId !== target.appId) {
        throw new Error("开发工具当前 AppID 与验证目标不一致");
      }
      if (!wx.cloud) {
        return Promise.reject(new Error("当前微信基础库不支持云开发能力"));
      }
      wx.cloud.init({ env: target.envId, traceUser: true });
      return wx.cloud.callFunction({ name: "auth-probe" }).then((response) => response.result);
    }, { envId, appId });

    assert.equal(result && result.ok, true);
    assert.equal(result.data.authenticated, true);
    assert.equal(typeof result.data.hasUnionId, "boolean");
    console.log(`CloudBase runtime auth probe passed: appId=${appId}, envId=${envId}`);
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
