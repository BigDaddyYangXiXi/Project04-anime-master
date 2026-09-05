const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const envId = "quest-band-d1gem4bxt3fa17720";

async function run() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const results = await miniProgram.evaluate(function callAccountBootstrapTwice(env) {
      wx.cloud.init({ env, traceUser: true });
      return wx.cloud.callFunction({ name: "account-bootstrap" })
        .then((first) => wx.cloud.callFunction({ name: "account-bootstrap" })
          .then((second) => [first.result, second.result]));
    }, envId);

    const [first, second] = results;
    assert.equal(first.ok, true, `first call failed: ${JSON.stringify(first.error)}`);
    assert.equal(second.ok, true, `second call failed: ${JSON.stringify(second.error)}`);
    assert.equal(first.data.account.id, second.data.account.id);
    assert.deepEqual(first.data.roles, ["BUYER", "PROVIDER"]);
    assert.deepEqual(second.data.roles, ["BUYER", "PROVIDER"]);
    assert.equal(JSON.stringify(results).includes("open_id"), false);
    assert.equal(JSON.stringify(results).includes("union_id"), false);
    console.log("CloudBase account bootstrap runtime audit passed: repeat calls reused one public account");
  } finally {
    miniProgram.disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
