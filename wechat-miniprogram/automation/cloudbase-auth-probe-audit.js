const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

const probePath = path.resolve(__dirname, "../cloudfunctions/auth-probe/index.js");
const originalLoad = Module._load;
let wxContext = {};

Module._load = function load(request, parent, isMain) {
  if (request === "wx-server-sdk") {
    return {
      DYNAMIC_CURRENT_ENV: "dynamic-current-env",
      init(options) {
        assert.equal(options.env, "dynamic-current-env");
      },
      getWXContext() {
        return wxContext;
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function run() {
  try {
    const probe = require(probePath);

    wxContext = {};
    const missing = await probe.main({ OPENID: "forged-client-value" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "AUTH_CONTEXT_MISSING");

    wxContext = {
      OPENID: "trusted-openid",
      APPID: "trusted-appid",
      UNIONID: "trusted-unionid"
    };
    const verified = await probe.main({ OPENID: "forged-client-value" });
    assert.deepEqual(verified, {
      ok: true,
      data: {
        authenticated: true,
        hasUnionId: true
      }
    });
    assert.equal(JSON.stringify(verified).includes("trusted-openid"), false);
    assert.equal(JSON.stringify(verified).includes("trusted-unionid"), false);

    console.log("CloudBase auth probe audit passed: 2/2");
  } finally {
    Module._load = originalLoad;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
