const { test } = require("node:test");
const assert = require("node:assert/strict");
const { inTransaction } = require("./payment-store");

for (const rollbackFails of [false, true]) {
  test(`preserves original failure and ${rollbackFails ? "discards broken" : "releases rolled-back"} connection`, async () => {
    const calls = [], original = new Error("write failed");
    const connection = {
      async beginTransaction() { calls.push("begin"); },
      async commit() { calls.push("commit"); },
      async rollback() { calls.push("rollback"); if (rollbackFails) throw new Error("connection lost"); },
      release() { calls.push("release"); }, destroy() { calls.push("destroy"); }
    };
    await assert.rejects(inTransaction({ getConnection: async () => connection }, async () => { throw original; }), (error) => error === original);
    assert.deepEqual(calls, ["begin", "rollback", rollbackFails ? "destroy" : "release"]);
  });
}

test("connection acquisition failure does not run work", async () => {
  let ran = false;
  await assert.rejects(inTransaction({ getConnection: async () => { throw new Error("unavailable"); } }, async () => { ran = true; }), /unavailable/);
  assert.equal(ran, false);
});
