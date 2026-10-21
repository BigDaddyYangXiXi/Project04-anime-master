const test = require("node:test"), assert = require("node:assert/strict");
const { confirmWithSlots } = require("./slot-store");
test("slot confirmation ignores onboarding history but keeps suspension and transaction protection", async () => {
  for (const status of [null, "PENDING", "REJECTED", "APPROVED", "SUSPENDED"]) {
    let committed = false, rolledBack = false, writes = 0, released = false;
    const row = { id: "order", provider_id: "provider", buyer_id: "buyer", request_hash: "hash", version: 1, stage: "CONTACTING",
      payload: JSON.stringify({ public: { timeSegments: [{ startsAt: 100, endsAt: 200 }] } }) };
    const connection = {
      beginTransaction: async () => {},
      execute: async sql => {
        if (sql.includes("FROM accounts")) return [[{ id: "provider" }]];
        if (sql.includes("FROM provider_qualifications")) return [status ? [{ status }] : []];
        if (sql.startsWith("SELECT * FROM order_aggregates")) return [[row]];
        if (sql.startsWith("SELECT stage,payload")) return [[]];
        if (sql.startsWith("UPDATE order_aggregates")) writes++;
        return [[]];
      },
      commit: async () => { committed = true; },
      rollback: async () => { rolledBack = true; },
      release: () => { released = true; }
    };
    const run = confirmWithSlots({ getConnection: async () => connection }, row, { ...row, stage: "BUYER_FINAL_CONFIRM", version: 2, updated_at: 1 });
    if (status === "SUSPENDED") {
      await assert.rejects(run, { code: "PROVIDER_NOT_AVAILABLE" });
      assert.equal(committed, false); assert.equal(rolledBack, true); assert.equal(writes, 0);
    } else {
      await run; assert.equal(committed, true); assert.equal(rolledBack, false); assert.equal(writes, 1);
    }
    assert.equal(released, true);
  }
});
