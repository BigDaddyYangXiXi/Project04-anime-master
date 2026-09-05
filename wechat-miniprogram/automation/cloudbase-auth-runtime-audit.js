const assert = require("node:assert/strict");
const automator = require("miniprogram-automator");

const wsEndpoint = process.env.WECHAT_AUTO_WS || "ws://127.0.0.1:9422";
const envId = "quest-band-d1gem4bxt3fa17720";

async function main() {
  const miniProgram = await automator.connect({ wsEndpoint });
  try {
    const results = await miniProgram.evaluate(async function auditAuth(env) {
      wx.cloud.init({ env, traceUser: true });
      const call = (data) => wx.cloud.callFunction({ name: "account-bootstrap", data }).then((response) => response.result);
      return {
        session: await call({ action: "getSession", accountId: "acct_client_forged" }),
        login: await call({ action: "login", openId: "openid_client_forged" }),
        unsupported: await call({ action: "deleteAccount" })
      };
    }, envId);

    assert.equal(results.session.ok, true, JSON.stringify(results.session.error));
    assert.equal(results.session.data.registered, true);
    assert.equal(results.login.ok, true, JSON.stringify(results.login.error));
    assert.equal(results.login.data.registered, true);
    assert.equal(results.session.data.account.id, results.login.data.account.id);
    assert.deepEqual(results.login.data.roles, ["BUYER", "PROVIDER"]);
    assert.equal(results.login.data.account.id === "acct_client_forged", false);
    assert.equal(JSON.stringify(results).includes("openid_client_forged"), false);
    assert.equal(results.unsupported.ok, false);
    assert.equal(results.unsupported.error.code, "UNSUPPORTED_ACTION");
    console.log("CloudBase auth runtime audit passed: session/login reuse trusted existing account and reject unsupported actions");
  } finally {
    miniProgram.disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
