const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "company-foundation-runtime-audit.js"), "utf8")
  .replace("run().catch((error)", "globalThis.finished = run().catch((error)");

async function runFailure({ appId = "wxc94e1c1b38944511", failure, failFirstObservation = false }) {
  const logs = [];
  let calls = 0;
  let disconnected = false;
  const app = {};
  let failedObservation = false;
  const mini = {
    evaluate: async (fn, target) => {
      if (failFirstObservation && fn.name === "readJob" && !failedObservation) {
        failedObservation = true;
        throw new Error("mock bridge observation timeout");
      }
      const value = vm.runInNewContext(`(${fn.toString()})(target)`, {
      target, getApp: () => app, wx: {
        getAccountInfoSync: () => ({ miniProgram: { appId } }),
        cloud: { init() {}, async callFunction() { calls++; throw failure; } }
      }
      });
      assert.ok(!value || typeof value.then !== "function", "bridge must never wait for the cloud promise");
      return value;
    },
    disconnect() { disconnected = true; }
  };
  const context = vm.createContext({
    require(name) {
      if (name === "node:assert/strict") return assert;
      if (name === "miniprogram-automator") return { connect: async () => mini };
      if (name.endsWith("project.config.json")) return { appid: "wxc94e1c1b38944511" };
      return { env: "cloudbase-d2g65rqbvee0bd978", envId: "cloudbase-d2g65rqbvee0bd978" };
    },
    console: { log: line => logs.push(line), error: line => logs.push(line) },
    process: { argv: [], env: {}, exitCode: 0 }, setTimeout
  });
  vm.runInContext(source, context);
  await context.finished;
  assert.equal(context.process.exitCode, 1);
  assert.equal(disconnected, true);
  assert.equal(Object.keys(app).length, 0);
  return { logs, calls };
}

test("SDK rejection preserves numeric diagnostics without leaking provider payloads", async () => {
  const result = await runFailure({ failure: {
    errCode: -504003, errMsg: "timeout PRIVATE_OPENID PRIVATE_URL PRIVATE_TOKEN",
    data: { secret: "PRIVATE_SECRET" }
  } });
  assert.equal(result.calls, 1);
  assert.equal(result.logs.join("").includes("PRIVATE_"), false);
  const diagnostic = JSON.parse(result.logs[0]);
  assert.equal(diagnostic.phase, "CLOUD_CALL");
  assert.equal(diagnostic.reason, "TIMEOUT");
  assert.equal(diagnostic.numericCode, -504003);
  assert.ok(diagnostic.elapsedMs >= 0);
});

test("an observation timeout polls the same job instead of repeating the cloud request", async () => {
  const result = await runFailure({ failFirstObservation: true, failure: { errCode: -1, errMsg: "PRIVATE_FAILURE" } });
  assert.equal(result.calls, 1);
  assert.equal(JSON.parse(result.logs[0]).numericCode, -1);
  assert.equal(result.logs.join("").includes("PRIVATE_FAILURE"), false);
});

test("wrong live AppID stops before any cloud request", async () => {
  const result = await runFailure({ appId: "wrong-app", failure: {} });
  assert.equal(result.calls, 0);
  const diagnostic = JSON.parse(result.logs[0]);
  assert.equal(diagnostic.phase, "APP_ID_CHECK");
  assert.equal(diagnostic.reason, "APP_ID_MISMATCH");
});
