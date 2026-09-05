const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function entryFor(error) {
  const sandbox = { exports: {}, process: { env: {} }, console: { error() {} }, require(name) {
    if (name === "./order-core") return { handleOrder: async () => { throw error; } };
    if (name === "@cloudbase/node-sdk") return {
      getCloudbaseContext: () => ({ WX_OPENID: "trusted-buyer" }),
      init: () => ({ rdb: () => ({}) })
    };
    throw new Error(`unexpected dependency: ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, "utf8"), sandbox);
  return sandbox.exports.main;
}

test("cloud entry preserves actionable cooperation and agreement rejections", async () => {
  for (const code of ["COOPERATION_CONFIRMATION_REQUIRED", "AGREEMENT_NOT_CONFIRMED", "PROVIDER_ROLE_REQUIRED"]) {
    const result = await entryFor({ code })({ action: "transitionOrder" }, {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
  }
});

test("cloud entry still hides internal errors and their contents", async () => {
  const result = await entryFor({ code: "DATABASE_OPERATION_FAILED", message: "private database details" })({}, {});
  assert.equal(result.error.code, "ORDER_API_FAILED");
  assert.equal(JSON.stringify(result).includes("private database details"), false);
});
