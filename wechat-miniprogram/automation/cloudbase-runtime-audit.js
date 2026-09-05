const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const envId = "quest-band-d1gem4bxt3fa17720";

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const result = await miniProgram.evaluate(function callAuthProbe(env) {
      if (!wx.cloud) {
        return Promise.reject(new Error("当前微信基础库不支持云开发能力"));
      }
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({ name: "auth-probe" }).then((response) => response.result);
    }, envId);

    assert.deepEqual(result, {
      ok: true,
      data: {
        authenticated: true,
        hasUnionId: false
      }
    });
    console.log("CloudBase runtime auth probe passed: trusted WeChat identity verified");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
