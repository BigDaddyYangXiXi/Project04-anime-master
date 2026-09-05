const { test } = require("node:test");
const assert = require("node:assert/strict");
let definition;
global.Page = (value) => { definition = value; };
global.wx = { getStorageSync() { throw new Error("funds must not read demo storage"); }, navigateTo() {}, stopPullDownRefresh() {} };
const { formatCents } = require("../miniprogram/pages/funds/index");
delete global.Page;
const cloudOrders = require("../miniprogram/services/cloud-orders");
function response(patch = {}) {
  return { records: [{ id: "payment1", orderId: "order1", status: "PAID", totalFen: 10000, paidAt: 1788600000000, currency: "CNY" }],
    nextCursor: null, merchantStatus: "NOT_STARTED", settlementStatus: "UNAVAILABLE", withdrawableBalanceFen: null, ...patch };
}
function page() {
  const instance = { data: structuredClone(definition.data) };
  for (const [key, value] of Object.entries(definition)) if (typeof value === "function") instance[key] = value.bind(instance);
  instance.setData = (patch) => Object.assign(instance.data, patch);
  return instance;
}
test("funds page reads cloud receipts and opens the existing provider order route", async (t) => {
  t.mock.method(cloudOrders, "getProviderFunds", async () => response());
  const navigation = t.mock.method(wx, "navigateTo");
  const p = page(); await p.onShow();
  assert.equal(p.data.records[0].amountText, "￥100.00");
  assert.equal(p.data.loaded, true);
  assert.match(p.data.merchantCopy, /尚未开通/);
  assert.match(p.data.settlementCopy, /不代表已结算/);
  p.openOrder({ currentTarget: { dataset: { id: "payment1" } } });
  assert.equal(navigation.mock.calls[0].arguments[0].url, "/pages/provider-request/index?id=order1");
});
test("cloud failure stays a visible error, then retry renders a genuine empty response", async (t) => {
  let failed = true;
  t.mock.method(cloudOrders, "getProviderFunds", async () => { if (failed) throw { code: "ORDER_API_FAILED" }; return response({ records: [] }); });
  const p = page(); await p.onShow();
  assert.equal(p.data.loaded, false); assert.match(p.data.loadError, /无法读取/);
  failed = false; await p.load();
  assert.equal(p.data.loaded, true); assert.equal(p.data.loadError, ""); assert.deepEqual(p.data.records, []);
  assert.equal(formatCents(null), "—"); assert.equal(formatCents(-1), "—"); assert.equal(formatCents(0), "0.00");
  assert.equal(formatCents(Number.MAX_SAFE_INTEGER), "90071992547409.91");
});
test("pagination retry keeps records and prevents duplicate in-flight requests", async (t) => {
  const cursor = { id: "cursor", paidAt: 1000 };
  let release;
  t.mock.method(cloudOrders, "getProviderFunds", (value) => value ? new Promise((resolve, reject) => { release = reject; }) : Promise.resolve(response({ nextCursor: cursor })));
  const p = page(); await p.load();
  const pending = p.loadMore(); await p.loadMore();
  release(new Error("offline")); await pending;
  assert.equal(p.data.records.length, 1); assert.deepEqual(p.data.nextCursor, cursor); assert.match(p.data.moreError, /仍保留/);
  t.mock.method(cloudOrders, "getProviderFunds", async () => response({ records: [response().records[0], { ...response().records[0], id: "payment2", status: "PAID_REQUIRES_REVIEW" }] }));
  await p.loadMore(); assert.equal(p.data.records.length, 2); assert.equal(p.data.records[1].statusText, "付款待核对");
});
test("refresh wins over an older pending pagination response", async (t) => {
  let release;
  t.mock.method(cloudOrders, "getProviderFunds", (cursor) => cursor ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(response({ nextCursor: { id: "cursor", paidAt: 1000 } })));
  const p = page(); await p.load(); const old = p.loadMore();
  t.mock.method(cloudOrders, "getProviderFunds", async () => response({ records: [] }));
  await p.load(); release(response()); await old;
  assert.deepEqual(p.data.records, []); assert.equal(p.data.loadingMore, false);
});
