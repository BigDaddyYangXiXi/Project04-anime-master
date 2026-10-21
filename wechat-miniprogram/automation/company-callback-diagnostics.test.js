const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "company-callback-runtime-audit.js"), "utf8")
  .replace("run().catch(()", "globalThis.finished = run().catch(()");

async function runAudit({ wrongApp = false, failure = false } = {}) {
  const state = {}; const logs = []; let calls = 0; let interrupted = false; let disconnected = false;
  const mini = {
    async evaluate(fn, input) {
      if (fn.name === "readJob" && !interrupted) {
        interrupted = true; throw new Error("observation timeout");
      }
      const value = vm.runInNewContext(`(${fn.toString()})(input)`, {
        input, getApp: () => state, wx: {
          getAccountInfoSync: () => ({ miniProgram: { appId: wrongApp ? "wrong" : "wxc94e1c1b38944511" } }),
          cloud: { init() {}, async callFunction() {
            calls++;
            if (failure) throw new Error("PRIVATE_TOKEN");
            return { result: calls === 1 ? { statusCode: 200, body: "company-readonly-handshake" }
              : { statusCode: 403, body: "forbidden" } };
          } }
        }
      });
      assert.ok(!value || typeof value.then !== "function", "bridge must not wait for cloud completion");
      return value;
    },
    disconnect() { disconnected = true; }
  };
  const context = vm.createContext({ __dirname, setTimeout, process: { exitCode: 0 },
    console: { log: x => logs.push(x), error: x => logs.push(x) },
    require(name) {
      if (name === "miniprogram-automator") return { connect: async () => mini };
      if (name === "node:fs") return { readFileSync: () => JSON.stringify({ envId: "cloudbase-d2g65rqbvee0bd978",
        WX_APP_ID: "wxc94e1c1b38944511", WX_CALLBACK_TOKEN: "PRIVATE_TOKEN" }) };
      return require(name);
    }
  });
  vm.runInContext(source, context); await context.finished;
  assert.equal(disconnected, true);
  assert.equal(Object.keys(state).length, 0);
  assert.doesNotMatch(logs.join(""), /PRIVATE_TOKEN/);
  return { calls, exitCode: context.process.exitCode };
}

test("callback observation timeout does not repeat either signed request", async () => {
  assert.deepEqual(await runAudit(), { calls: 2, exitCode: 0 });
});
test("callback audit rejects wrong live AppID before cloud access", async () => {
  assert.deepEqual(await runAudit({ wrongApp: true }), { calls: 0, exitCode: 1 });
});
test("callback audit cleans up failed jobs without exposing SDK errors", async () => {
  assert.deepEqual(await runAudit({ failure: true }), { calls: 1, exitCode: 1 });
});
