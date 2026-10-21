const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readProviderFunds } = require("./funds-core");
const actor = { accountId: "provider", roles: ["PROVIDER"] };
test('partial and full refunds reduce expected income while preserving original payment facts', async () => {
  const db = database([payment(1, { refunded_fen: '3001', platform_refunded_fen: '600', provider_refunded_fen: '2401' }),
    payment(2, { refunded_fen: '10000', platform_refunded_fen: '2000', provider_refunded_fen: '8000' })]);
  const result = await readProviderFunds(db, actor, {});
  const partial = result.records.find(row => row.id === payment(1).id), full = result.records[0];
  assert.equal(partial.amountFen, 10000); assert.equal(partial.platformFeeFen, 2000);
  assert.equal(partial.retainedAmountFen, 6999); assert.equal(partial.retainedPlatformFeeFen, 1400);
  assert.equal(partial.expectedIncomeFen, 5599); assert.equal(full.expectedIncomeFen, 0);
  assert.equal(result.withdrawableBalanceFen, null);
});
test('missing or inconsistent refund projections fail rather than overstate income', async () => {
  for (const patch of [{ refunded_fen: undefined }, { refunded_fen: '1' },
    { refunded_fen: '10001', platform_refunded_fen: '2000', provider_refunded_fen: '8001' }]) {
    await assert.rejects(readProviderFunds(database([payment(1, patch)]), actor, {}), { code: 'DATABASE_OPERATION_FAILED' });
  }
});

test('balanced but wrong fee or reversal allocations cannot be shown as provider income', async () => {
  for (const patch of [{platform_fee_fen:'1999'}, {fee_rule_version:'UNKNOWN'},
    {refunded_fen:'3001',platform_refunded_fen:'601',provider_refunded_fen:'2400'}]) {
    await assert.rejects(readProviderFunds(database([payment(1,patch)]),actor,{}),{code:'DATABASE_OPERATION_FAILED'});
  }
});

test('income validation agrees with payment fee policy at cent rounding boundaries and large amounts', async () => {
  const {platformFee,refundAllocation}=require('../payment-api/fee-policy');
  for (const total of [1,2,3,4,5,6,7,8,9,10,99,100,101,Number.MAX_SAFE_INTEGER]) {
    const fee=platformFee(total);
    for (const refunded of [...new Set([0,1,Math.floor(total/2),total])]) {
      const allocation=refunded ? refundAllocation({totalFen:total,platformFeeFen:fee.amountFen,feeRuleVersion:fee.version,previouslyRefundedFen:0,refundFen:refunded}) : {platformReversalFen:0,providerReversalFen:0};
      const result=await readProviderFunds(database([payment(1,{amount_fen:String(total),received_total_fen:String(total),payer_paid_fen:String(total),
        platform_fee_fen:String(fee.amountFen),refunded_fen:String(refunded),platform_refunded_fen:String(allocation.platformReversalFen),provider_refunded_fen:String(allocation.providerReversalFen)})]),actor,{});
      assert.equal(result.records[0].expectedIncomeFen,total-fee.amountFen-allocation.providerReversalFen);
    }
  }
});
function payment(index, patch = {}) {
  return { id: index.toString(16).padStart(32, "0"), order_id: `order_${index}`, status: "PAID", transaction_id: `wx_${index}`,
    amount_fen: "10000", platform_fee_fen: '2000', fee_rule_version: 'PLATFORM_20_PERCENT_V1', received_total_fen: "10000", payer_paid_fen: "9800", received_currency: "CNY", paid_at: "1000",
    refunded_fen: '0', platform_refunded_fen: '0', provider_refunded_fen: '0',
    order_aggregates: { provider_id: "provider" }, ...patch };
}
function database(payments, merchants = [], broken = false) {
  const calls = [];
  return { calls, from(table) {
    const filters = [], sort = []; let maximum = Infinity;
    return {
      select(fields) { calls.push({ table, fields }); return this; },
      eq(column, expected) { filters.push((row) => String(column.includes(".") ? row.order_aggregates.provider_id : row[column]) === String(expected)); return this; },
      lt(column, expected) { filters.push((row) => column === "id" ? row[column] < expected : Number(row[column]) < expected); return this; },
      in(column, expected) { filters.push((row) => expected.includes(row[column])); return this; },
      order(column) { sort.push(column); return this; }, limit(value) { maximum = value; return this; },
      then(resolve) {
        const source = table === "order_payments" ? payments : merchants;
        const data = source.filter((row) => filters.every((filter) => filter(row))).sort((a, b) => {
          for (const column of sort) { const result = column === "id" ? b[column].localeCompare(a[column]) : Number(b[column]) - Number(a[column]); if (result) return result; }
          return 0;
        }).slice(0, maximum);
        return Promise.resolve(broken ? { error: { code: "missing table" } } : { data, error: null }).then(resolve);
      }
    };
  } };
}
test("funds are scoped to trusted provider and omit payment identity and balance claims", async () => {
  const db = database([payment(1), payment(2, { status: "PAID_REQUIRES_REVIEW" }), payment(3, { status: "CREATED" }),
    payment(4, { order_aggregates: { provider_id: "someone_else" } })]);
  const result = await readProviderFunds(db, actor, { providerId: "someone_else" });
  assert.deepEqual(result.records.map((r) => r.id), [payment(2).id, payment(1).id]);
  assert.equal(result.withdrawableBalanceFen, null);
  assert.equal(result.settlementStatus, "UNAVAILABLE");
  assert.equal(result.merchantStatus, "NOT_STARTED");
  assert.equal(JSON.stringify(result).includes("transaction_id"), false);
  assert.equal(JSON.stringify(result).includes("provider_id"), false);
  assert.equal(result.records[0].totalFen, 10000);
  assert.equal(result.records[0].expectedIncomeFen, null);
  assert.equal(result.records[1].expectedIncomeFen, 8000);
  assert.equal(result.records[1].platformFeeFen, 2000);
});
test("pagination handles more than 20 receipts with identical times without missing or repeating records", async () => {
  const db = database(Array.from({ length: 25 }, (_, i) => payment(i + 1)).concat(payment(26, { paid_at: "900" })));
  const first = await readProviderFunds(db, actor, {});
  const next = await readProviderFunds(db, actor, { cursor: first.nextCursor });
  assert.equal(first.records.length, 20);
  assert.equal(next.records.length, 6);
  assert.equal(new Set([...first.records, ...next.records].map((row) => row.id)).size, 26);
  assert.equal(next.nextCursor, null);
});
test("buyer role and invalid cursors are rejected before funds queries", async () => {
  const db = database([]);
  await assert.rejects(readProviderFunds(db, { accountId: "buyer", roles: ["BUYER"] }, {}), (e) => e.code === "PROVIDER_ROLE_REQUIRED");
  for (const cursor of ["bad", { id: "injection", paidAt: 1 }, { id: payment(1).id, paidAt: "1000" }]) {
    await assert.rejects(readProviderFunds(db, actor, { cursor }), (e) => e.code === "VALIDATION_ERROR");
  }
  assert.equal(db.calls.length, 0);
});
test("database failure and invalid payment data never become empty successful accounts", async () => {
  for (const db of [database([], [], true), database([payment(1, { transaction_id: null })]), database([payment(1, { received_total_fen: null })]), database([payment(1, { received_total_fen: "11000" })])]) {
    await assert.rejects(readProviderFunds(db, actor, {}), (e) => e.code === "DATABASE_OPERATION_FAILED");
  }
});
