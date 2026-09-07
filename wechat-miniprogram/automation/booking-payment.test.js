const test = require("node:test");
const assert = require("node:assert/strict");
let definition;
global.Page = (value) => { definition = value; };
global.wx = { showModal() {}, showToast() {} };
require("../miniprogram/pages/booking-status/index");
delete global.Page;
const cloudOrders = require("../miniprogram/services/cloud-orders");
const gateway = require("../miniprogram/data/payment-gateway");
const store = require("../miniprogram/data/v063-store");

function order(patch = {}) {
  return { id: "order-buyer", version: 3, cloudOrder: true, viewerRole: "BUYER",
    stage: "BUYER_FINAL_CONFIRM", communicationDone: true, timePlaceConfirmed: true,
    serviceScopeConfirmed: true, amountConfirmed: true, executable: true, ndaRequired: false,
    buyerAgreementConfirmedAt: 1000, paymentStatus: "UNPAID", finalPrice: 680,
    paymentRequest: { timeStamp: "1", nonceStr: "nonce", package: "prepay_id=fresh", paySign: "signature" }, ...patch };
}
function pageFor(source = order()) {
  const page = { cloudMode: true, orderId: source.id, data: structuredClone(definition.data) };
  for (const [key, value] of Object.entries(definition)) if (typeof value === "function") page[key] = value.bind(page);
  page.setData = (patch) => Object.assign(page.data, patch);
  page.renderOrder(source);
  return page;
}
function prohibitLocalWrites(t) {
  return t.mock.method(store, "updateOrder", () => { assert.fail("cloud payment must not write local orders"); });
}

test("cloud payment uses fresh server parameters and re-reads payment facts after cashier success", async (t) => {
  const writes = prohibitLocalWrites(t);
  const page = pageFor(order({ paymentRequest: { package: "stale" } }));
  const fresh = order();
  let reads = 0;
  t.mock.method(cloudOrders, "getOrder", async () => ++reads === 1 ? fresh : order({ paymentStatus: "PAID", version: 4 }));
  t.mock.method(gateway, "requestOrderPayment", async (input) => assert.equal(input.paymentRequest.package, "prepay_id=fresh"));
  await page.startPayment();
  assert.equal(reads, 2);
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(page.data.paymentStatus, "PAID");
  assert.equal(page.data.paying, false);
});

test("cancelled or failed cashier does not override a late successful server payment", async (t) => {
  prohibitLocalWrites(t);
  for (const code of ["PAYMENT_CANCELLED", "PAYMENT_FAILED"]) {
    const page = pageFor();
    let reads = 0;
    t.mock.method(cloudOrders, "getOrder", async () => order({ paymentStatus: ++reads === 1 ? "UNPAID" : "PAID" }));
    t.mock.method(gateway, "requestOrderPayment", async () => { throw { code }; });
    await page.startPayment();
    assert.equal(reads, 2);
    assert.equal(page.data.paymentStatus, "PAID");
    assert.match(page.data.paymentHint, /已确认/);
  }
});

test("cloud payment rejects stale eligibility and never opens cashier for another participant", async (t) => {
  prohibitLocalWrites(t);
  const pay = t.mock.method(gateway, "requestOrderPayment", async () => {});
  for (const patch of [{ paymentStatus: "PAID" }, { paymentStatus: "VERIFYING" }, { viewerRole: "PROVIDER" },
    { stage: "DECLINED" }, { buyerAgreementConfirmedAt: null }, { timePlaceConfirmed: false },
    { ndaRequired: true, buyerNdaSigned: true, providerNdaSigned: false }]) {
    t.mock.method(cloudOrders, "getOrder", async () => order(patch));
    const page = pageFor();
    await page.startPayment();
    assert.equal(page.data.paying, false);
  }
  assert.equal(pay.mock.callCount(), 0);
});

test("unavailable configuration, uncertain result and query failures do not fabricate payment facts", async (t) => {
  prohibitLocalWrites(t);
  for (const scenario of ["unconfigured", "unpaid", "query-failed", "preflight-failed"]) {
    const page = pageFor();
    let reads = 0;
    t.mock.method(cloudOrders, "getOrder", async () => {
      reads++;
      if (scenario === "preflight-failed" || scenario === "query-failed" && reads === 2) throw new Error("offline");
      return order();
    });
    const pay = t.mock.method(gateway, "requestOrderPayment", async () => {
      if (scenario === "unconfigured") throw { code: "PAYMENT_NOT_CONFIGURED" };
    });
    await page.startPayment();
    assert.equal(page.data.paymentStatus, "UNPAID");
    assert.equal(page.data.paying, false);
    if (scenario === "preflight-failed") assert.equal(pay.mock.callCount(), 0);
    if (scenario === "unpaid" || scenario === "query-failed") assert.match(page.data.paymentHint, /确认|核对/);
  }
});

test("repeated clicks share one in-flight payment attempt", async (t) => {
  prohibitLocalWrites(t);
  const page = pageFor();
  let release;
  t.mock.method(cloudOrders, "getOrder", async () => order());
  const pay = t.mock.method(gateway, "requestOrderPayment", () => new Promise((resolve) => { release = resolve; }));
  const first = page.startPayment();
  await new Promise((resolve) => setImmediate(resolve));
  await page.startPayment();
  assert.equal(pay.mock.callCount(), 1);
  release();
  await first;
  assert.equal(page.data.paying, false);
});

test("payment review prevents another cashier attempt and survives late cashier errors", async (t) => {
  prohibitLocalWrites(t);
  const page = pageFor(order({ paymentStatus: "PAYMENT_REVIEW" }));
  const pay = t.mock.method(gateway, "requestOrderPayment", async () => { throw { code: "PAYMENT_CANCELLED" }; });
  let reads = 0;
  t.mock.method(cloudOrders, "getOrder", async () => order({ paymentStatus: ++reads === 1 ? "UNPAID" : "PAYMENT_REVIEW" }));
  await page.startPayment();
  assert.equal(pay.mock.callCount(), 0);
  assert.equal(reads, 0);
  assert.match(page.data.paymentHint, /请勿重复付款/);
  page.renderOrder(order());
  await page.startPayment();
  assert.equal(page.data.paymentStatus, "PAYMENT_REVIEW");
  assert.match(page.data.paymentHint, /需要核对/);
});

test("an older preflight response cannot reopen cashier after a newer paid order renders", async (t) => {
  prohibitLocalWrites(t);
  const page = pageFor();
  let resolve;
  t.mock.method(cloudOrders, "getOrder", () => new Promise(done => { resolve = done; }));
  const pay = t.mock.method(gateway, "requestOrderPayment", async () => {});
  const request = page.startPayment();
  page.renderOrder(order({ version: 4, paymentStatus: "PAID" }));
  resolve(order());
  await request;
  assert.equal(pay.mock.callCount(), 0);
  assert.equal(page.data.paymentStatus, "PAID");
  assert.equal(page.data.paying, false);
});

test("an older post-cashier response cannot replace a newer review result or its warning", async (t) => {
  prohibitLocalWrites(t);
  const page = pageFor();
  let reads = 0;
  t.mock.method(cloudOrders, "getOrder", async () => {
    if (++reads === 2) page.renderOrder(order({ version: 5, paymentStatus: "PAYMENT_REVIEW" }));
    return order();
  });
  t.mock.method(gateway, "requestOrderPayment", async () => {});
  await page.startPayment();
  assert.equal(page.data.paymentStatus, "PAYMENT_REVIEW");
  assert.match(page.data.paymentHint, /需要核对，请勿重复付款/);
});
