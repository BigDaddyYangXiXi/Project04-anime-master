const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function entryFor(error, caller = { WX_OPENID: 'trusted-buyer', WX_APPID: 'wxc94e1c1b38944511' }) {
  const sandbox = { exports: {}, process: { env: {} }, console: { error() {} }, require(name) {
    if (name === './request-context') return () => caller;
    if (name === "./order-core") return { handleOrder: async () => { throw error; } };
    if (name === "@cloudbase/node-sdk") return {
      getCloudbaseContext: () => caller,
      init: () => ({ rdb: () => ({}) })
    };
    throw new Error(`unexpected dependency: ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, "utf8"), sandbox);
  return sandbox.exports.main;
}

test('order entry rejects missing and foreign application identities before business dispatch', async () => {
  for (const caller of [{}, { WX_OPENID: 'trusted-buyer' }, { WX_OPENID: 'trusted-buyer', WX_APPID: 'other-app' }]) {
    const result = await entryFor({ code: 'DATABASE_OPERATION_FAILED' }, caller)({ action: 'listOrders' }, {});
    assert.equal(result.error.code, 'AUTH_CONTEXT_MISSING');
  }
});

test("cloud entry preserves actionable cooperation and agreement rejections", async () => {
  for (const code of ["COOPERATION_CONFIRMATION_REQUIRED", "AGREEMENT_NOT_CONFIRMED", "PROVIDER_ROLE_REQUIRED", "SCHEDULE_CONFLICT", "SLOT_STORE_NOT_CONFIGURED"]) {
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

test('notification failure cannot convert a committed order into an API failure, and reads never trigger', async () => {
  for (const action of ['createOrder', 'transitionOrder', 'getOrder']) {
    let committed = false, triggered = 0;
    const caller = { WX_OPENID: 'buyer', WX_APPID: 'wxc94e1c1b38944511' };
    const data = { id: 'persisted-order' };
    const sandbox = { exports: {}, process: { env: { ORDER_NOTIFICATION_ENABLED: 'true' } },
      console: { error() {}, log() {} }, require(name) {
    if (name === './request-context') return () => caller;
        if (name === './order-core') return { handleOrder: async () => { committed = true; return data; } };
        if (name === './notification-trigger') return { triggerNotification: async () => {
          assert.equal(committed, true); triggered++; throw Error('transport failure');
        } };
        if (name === '@cloudbase/node-sdk') return { getCloudbaseContext: () => ({ WX_OPENID: 'buyer', WX_APPID: 'wxc94e1c1b38944511' }),
          init: () => ({ rdb: () => ({}) }) };
        throw Error('unexpected dependency');
      } };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
    const result = await sandbox.exports.main({ action });
    assert.equal(result.ok, true); assert.equal(result.data, data);
    assert.equal(triggered, action === 'getOrder' ? 0 : 1);
  }
});
