// Explicit local MySQL test; never connects to a configured application database.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("../cloudfunctions/payment-api/node_modules/mysql2/promise");
const { reservePayment, recordPaymentSuccess, recordPaymentClosed } = require("../cloudfunctions/payment-api/payment-store");
const { handleOrder, encryptContact } = require("../cloudfunctions/order-api/order-core");
const { toClientOrder } = require("../miniprogram/services/cloud-orders");
const contactKey = Buffer.alloc(32, 17).toString("base64");
const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Explicit PAYMENT_TEST_MYSQL_PORT required (local test instance only)");
const database = `anime_payment_test_${crypto.randomBytes(8).toString("hex")}`;
const config = { host: "127.0.0.1", port, user: "root", password: process.env.PAYMENT_TEST_MYSQL_PASSWORD || "", supportBigNumbers: true, bigNumberStrings: true };
let admin, pool;
const now = 1788600000000;
const input = (overrides = {}) => ({ orderId: "order_1", buyerId: "buyer", requestKey: "request_0000000001", expectedVersion: 1,
  appid: "test_app", platformMchid: "test_platform", payerOpenid: "test_openid", fee: { version: "TEST_ONLY", amountFen: 100 }, ...overrides });
const result = (payment, overrides = {}) => ({ tradeState: "SUCCESS", combineOutTradeNo: payment.id, outTradeNo: payment.id,
  appid: payment.appid, platformMchid: payment.platform_mchid, subMchid: payment.sub_mchid, payerOpenid: payment.payer_openid,
  transactionId: `wx_${payment.id}`, totalFen: 10000, payerPaidFen: 9800, currency: "CNY", paidAt: now + 100, ...overrides });
const code = (expected) => (error) => error.code === expected;
async function order(id = "order_1") { const [[row]] = await pool.execute("SELECT * FROM order_aggregates WHERE id = ?", [id]); return row; }
async function payments() { const [rows] = await pool.query("SELECT * FROM order_payments ORDER BY created_at, id"); return rows; }
async function seedOrder(id) {
  const payload = { public: { amountFen: 10000, paymentStatus: "UNPAID", buyerAgreementConfirmedAt: now,
    communicationDone: true, timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true, executable: true, ndaRequired: false,
    items: [{ serviceId: "test_service", name: "TEST", finalPriceFen: 10000 }], timeSegments: [{ startsAt: now, endsAt: now + 3600000 }] },
    contactEncrypted: encryptContact({ name: "TEST", wechat: "test_only", phone: "" }, contactKey), events: [] };
  await pool.execute("INSERT INTO order_aggregates (id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,created_at,updated_at) VALUES (?,'buyer','provider',?,?,'BUYER_FINAL_CONFIRM',?,?,?)",
    [id, id, "0".repeat(64), JSON.stringify(payload), now, now]);
}
before(async () => {
  admin = await mysql.createConnection(config);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  pool = mysql.createPool({ ...config, database, connectionLimit: 12 });
  const folder = path.join(__dirname, "../database/mysql");
  for (const file of fs.readdirSync(folder).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort()) {
    for (const sql of fs.readFileSync(path.join(folder, file), "utf8").split(";").filter((s) => s.trim())) await pool.query(sql);
  }
  await pool.query("INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES ('buyer','buyer','TEST',1,1),('provider','provider','TEST',1,1)");
  await pool.query("INSERT INTO wechat_identities (account_id,open_id,created_at,updated_at) VALUES ('buyer','test_openid',1,1),('provider','test_provider_openid',1,1)");
  await pool.query("INSERT INTO account_roles VALUES ('buyer','BUYER',1),('provider','PROVIDER',1)");
});
beforeEach(async () => {
  await pool.query("DELETE FROM order_payments");
  await pool.query("DELETE FROM order_aggregates");
  await pool.query("DELETE FROM provider_payment_merchants");
  await pool.query("INSERT INTO provider_payment_merchants VALUES ('provider','test_platform','test_sub','READY',1)");
  await seedOrder("order_1");
});
after(async () => {
  if (pool) await pool.end();
  if (admin) {
    assert.match(database, /^anime_payment_test_[a-f0-9]{16}$/);
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  }
});

test("20 concurrent retries create exactly one payment", async () => {
  const rows = await Promise.all(Array.from({ length: 20 }, () => reservePayment(pool, input(), now)));
  assert.equal(new Set(rows.map((p) => p.id)).size, 1);
  assert.equal((await payments()).length, 1);
  assert.equal((await order()).version, 1);
});
test("different concurrent request keys cannot open multiple payments", async () => {
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => reservePayment(pool, input({ requestKey: `request_distinct_${i}` }), now)));
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.ok(outcomes.filter((r) => r.status === "rejected").every((r) => r.reason.code === "PAYMENT_ALREADY_EXISTS"));
});
test("buyer, version, confirmation, fee and merchant gates prevent records", async () => {
  await assert.rejects(reservePayment(pool, input({ buyerId: "stranger" })), code("ORDER_NOT_FOUND"));
  await assert.rejects(reservePayment(pool, input({ expectedVersion: 2 })), code("VERSION_CONFLICT"));
  await assert.rejects(reservePayment(pool, input({ fee: null })), code("PAYMENT_FEE_NOT_CONFIGURED"));
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.amountConfirmed', false)");
  await assert.rejects(reservePayment(pool, input()), code("AGREEMENT_NOT_CONFIRMED"));
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.amountConfirmed', true)");
  await pool.query("UPDATE provider_payment_merchants SET status='PENDING'");
  await assert.rejects(reservePayment(pool, input()), code("PAYMENT_MERCHANT_NOT_READY"));
  assert.equal((await payments()).length, 0);
});
test("20 duplicate notifications update order and event exactly once", async () => {
  const p = await reservePayment(pool, input(), now);
  const receipts = await Promise.all(Array.from({ length: 20 }, () => recordPaymentSuccess(pool, result(p), now + 200)));
  assert.equal(receipts.filter((r) => !r.duplicate).length, 1);
  const saved = await order();
  assert.equal(saved.version, 2);
  assert.equal(saved.payload.public.paymentStatus, "PAID");
  assert.equal(saved.payload.events.length, 1);
  assert.equal(saved.stage, "BUYER_FINAL_CONFIRM");
  assert.equal(Number((await payments())[0].payer_paid_fen), 9800);
});
test("identity mismatches never mutate payment or order", async () => {
  const p = await reservePayment(pool, input(), now);
  for (const field of ["combineOutTradeNo", "appid", "platformMchid", "subMchid", "payerOpenid"]) {
    await assert.rejects(recordPaymentSuccess(pool, result(p, { [field]: "wrong" })), code("PAYMENT_RESULT_MISMATCH"));
  }
  assert.equal((await payments())[0].status, "CREATED");
  assert.equal((await order()).version, 1);
});
test("actual money with unexpected amount is retained for review", async () => {
  const p = await reservePayment(pool, input(), now);
  assert.equal((await recordPaymentSuccess(pool, result(p, { totalFen: 12000 }))).status, "PAID_REQUIRES_REVIEW");
  assert.equal(Number((await payments())[0].received_total_fen), 12000);
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
});
test("changed agreement cannot start execution from old payment", async () => {
  const p = await reservePayment(pool, input(), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.location', 'changed')");
  assert.equal((await recordPaymentSuccess(pool, result(p))).status, "PAID_REQUIRES_REVIEW");
  assert.equal((await payments())[0].review_reason, "AGREEMENT_OR_STAGE_CHANGED");
});
function faultyPool(fault) {
  return { async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, key) {
      if (key === "execute" && fault === "write") return async (sql, args) => {
        if (sql.startsWith("UPDATE order_aggregates")) throw new Error("injected order write failure");
        return target.execute(sql, args);
      };
      if (key === "commit" && fault === "ack") return async () => { await target.commit(); throw new Error("injected commit acknowledgement loss"); };
      return typeof target[key] === "function" ? target[key].bind(target) : target[key];
    } });
  } };
}
test("order write failure rolls back actual receipt write in MySQL", async () => {
  const p = await reservePayment(pool, input(), now);
  await assert.rejects(recordPaymentSuccess(faultyPool("write"), result(p)), /injected order write failure/);
  const row = (await payments())[0];
  assert.equal(row.status, "CREATED"); assert.equal(row.transaction_id, null);
  assert.equal((await order()).version, 1);
  assert.equal((await recordPaymentSuccess(pool, result(p))).status, "PAID");
});
test("lost commit acknowledgement recovers through idempotent retry", async () => {
  const p = await reservePayment(pool, input(), now);
  await assert.rejects(recordPaymentSuccess(faultyPool("ack"), result(p)), /acknowledgement loss/);
  assert.equal((await recordPaymentSuccess(pool, result(p))).duplicate, true);
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
});
test("close and success race never loses a receipt or reverses paid state", async () => {
  const p = await reservePayment(pool, input(), now);
  await Promise.all([recordPaymentClosed(pool, result(p, { tradeState: "CLOSED" })), recordPaymentSuccess(pool, result(p))]);
  const saved = (await payments())[0];
  assert.ok(["PAID", "PAID_REQUIRES_REVIEW"].includes(saved.status));
  assert.equal(saved.transaction_id, result(p).transactionId);
  assert.equal((await recordPaymentClosed(pool, result(p, { tradeState: "CLOSED" }))).status, saved.status);
});
test("late success on closed attempt prevents automatic confirmation of another receipt", async () => {
  const old = await reservePayment(pool, input(), now);
  await recordPaymentClosed(pool, result(old, { tradeState: "CLOSED" }));
  const next = await reservePayment(pool, input({ requestKey: "request_0000000002" }), now + 1);
  await recordPaymentSuccess(pool, result(old));
  assert.equal((await recordPaymentSuccess(pool, result(next))).status, "PAID_REQUIRES_REVIEW");
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
});
test("database rejects a channel transaction reused across two orders", async () => {
  const p = await reservePayment(pool, input(), now);
  await recordPaymentSuccess(pool, result(p));
  await seedOrder("order_2");
  const second = await reservePayment(pool, input({ orderId: "order_2" }), now);
  await assert.rejects(recordPaymentSuccess(pool, result(second, { transactionId: result(p).transactionId })), code("ER_DUP_ENTRY"));
  assert.equal((await order("order_2")).version, 1);
});
test("database rejects fake paid state with no receipt", async () => {
  await reservePayment(pool, input(), now);
  await assert.rejects(pool.query("UPDATE order_payments SET status='PAID'"), code("ER_CHECK_CONSTRAINT_VIOLATED"));
});

// Read-only CloudBase query shape backed by the real local database, not an in-memory order fixture.
function databaseReader() {
  return { from(table) {
    assert.ok(["accounts", "wechat_identities", "account_roles", "order_aggregates"].includes(table));
    const filters = [];
    return { select() { return this; }, eq(column, value) { assert.match(column, /^[a-z_]+$/); filters.push([column, value]); return this; },
      then(resolve, reject) {
        return pool.execute(`SELECT * FROM \`${table}\` WHERE ${filters.map(([column]) => `\`${column}\` = ?`).join(" AND ")}`,
          filters.map(([, value]) => value)).then(([data]) => ({ data, error: null })).then(resolve, reject);
      }
    };
  } };
}
test("persisted review flows through server participant checks and actual buyer/provider pages", async () => {
  const p = await reservePayment(pool, input(), now);
  await recordPaymentSuccess(pool, result(p, { totalFen: 12000 }));
  for (const [openId, role, pageName] of [["test_openid", "BUYER", "booking-status"], ["test_provider_openid", "PROVIDER", "provider-request"]]) {
    const response = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_1" }, { WX_OPENID: openId }, contactKey);
    assert.equal(response.viewerRole, role);
    assert.equal(response.paymentStatus, "PAYMENT_REVIEW");
    const client = toClientOrder(response);
    let definition;
    global.Page = (value) => { definition = value; };
    require(`../miniprogram/pages/${pageName}/index`);
    delete global.Page;
    const page = { cloudMode: true, data: structuredClone(definition.data) };
    for (const [key, value] of Object.entries(definition)) if (typeof value === "function") page[key] = value.bind(page);
    page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
    page.renderOrder(client);
    assert.equal(page.data.order.paymentStatus, "PAYMENT_REVIEW");
    if (role === "BUYER") assert.match(page.data.paymentHint, /请勿重复付款/);
    else assert.equal(page.data.isWaitingBuyerConfirm, true);
  }
  await assert.rejects(handleOrder(databaseReader(), { action: "transitionOrder", orderId: "order_1", expectedVersion: 2, event: "BUYER_CONFIRMS_EXECUTION" },
    { WX_OPENID: "test_openid" }, contactKey), code("PAYMENT_NOT_VERIFIED"));
});
