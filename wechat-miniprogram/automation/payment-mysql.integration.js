// Explicit local MySQL test; never connects to a configured application database.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const mysql = require("../cloudfunctions/payment-api/node_modules/mysql2/promise");
const { reservePayment, recordPaymentSuccess, recordPaymentClosed } = require("../cloudfunctions/payment-api/payment-store");
const { acceptPaymentNotification, acceptPaymentQuery } = require("../cloudfunctions/payment-api/payment-notifications");
const { createNotificationFixture } = require("../cloudfunctions/payment-api/test-notification-fixture");
const { queryPayment } = require("../cloudfunctions/payment-api/wechat-query");
const { createQueryFixture } = require("../cloudfunctions/payment-api/test-query-fixture");
const notificationFixture = createNotificationFixture();
const queryFixture = createQueryFixture(notificationFixture.config);
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
  appid: payment.appid, platformMchid: payment.platform_mchid, subMchid: payment.sub_mchid, payerOpenid: payment.payer_openid, payerVerification: "MATCHED",
  transactionId: `wx_${payment.id}`, totalFen: 10000, payerPaidFen: 9800, currency: "CNY", paidAt: now + 100, ...overrides });
const code = (expected) => (error) => error.code === expected;
function queryResult(p, tradeState) {
  return notificationFixture.sign(JSON.stringify({ combine_appid: p.appid, combine_mchid: p.platform_mchid, combine_out_trade_no: p.id,
    sub_orders: [{ mchid: p.platform_mchid, sub_mchid: p.sub_mchid, out_trade_no: p.id, trade_state: tradeState }] }), now + 200);
}
async function order(id = "order_1") { const [[row]] = await pool.execute("SELECT * FROM order_aggregates WHERE id = ?", [id]); return row; }
async function payments() { const [rows] = await pool.query("SELECT * FROM order_payments ORDER BY created_at, id"); return rows; }
async function seedOrder(id, providerId = "provider") {
  const payload = { public: { amountFen: 10000, paymentStatus: "UNPAID", buyerAgreementConfirmedAt: now,
    communicationDone: true, timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true, executable: true, ndaRequired: false,
    items: [{ serviceId: "test_service", name: "TEST", finalPriceFen: 10000 }], timeSegments: [{ startsAt: now, endsAt: now + 3600000 }] },
    contactEncrypted: encryptContact({ name: "TEST", wechat: "test_only", phone: "" }, contactKey), events: [] };
  await pool.execute("INSERT INTO order_aggregates (id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,created_at,updated_at) VALUES (?,'buyer',?,?,?,'BUYER_FINAL_CONFIRM',?,?,?)",
    [id, providerId, id, "0".repeat(64), JSON.stringify(payload), now, now]);
}
before(async () => {
  admin = await mysql.createConnection(config);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  pool = mysql.createPool({ ...config, database, connectionLimit: 12 });
  const folder = path.join(__dirname, "../database/mysql");
  for (const file of fs.readdirSync(folder).filter((name) => /^\d{4}.*\.sql$/.test(name)).sort()) {
    if (file === "0019_payment_payer_verification.sql") {
      await pool.query("INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES ('buyer','buyer','TEST',1,1),('provider','provider','TEST',1,1)");
      await seedOrder("migration_order");
      await pool.query(`INSERT INTO order_payments
        (id,order_id,request_key,order_version,agreement_hash,appid,platform_mchid,sub_mchid,payer_openid,amount_fen,fee_rule_version,platform_fee_fen,status,transaction_id,received_total_fen,payer_paid_fen,received_currency,paid_at,created_at,updated_at)
        VALUES ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','migration_order','migration_request',1,REPEAT('0',64),'test_app','test_platform','test_sub','test_openid',10000,'TEST_ONLY',100,'PAID','legacy_verified_transaction',10000,9800,'CNY',1,1,1)`);
    }
    for (const sql of fs.readFileSync(path.join(folder, file), "utf8").split(";").filter((s) => s.trim())) await pool.query(sql);
  }
  const [[migrated]] = await pool.query("SELECT payer_verification FROM order_payments WHERE transaction_id = 'legacy_verified_transaction'");
  assert.equal(migrated.payer_verification, "MATCHED");
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
    assert.ok(["accounts", "wechat_identities", "account_roles", "order_aggregates", "order_payments", "provider_payment_merchants"].includes(table));
    const filters = [], values = [], sorting = [];
    let limit = "", join = false;
    const columnName = (column) => {
      assert.match(column, /^(order_aggregates\.)?[a-z_]+$/);
      return column.includes(".") ? `o.\`${column.split(".")[1]}\`` : `t.\`${column}\``;
    };
    return { select(fields = "") { join = fields.includes("!inner"); return this; },
      eq(column, value) { filters.push(`${columnName(column)} = ?`); values.push(value); return this; },
      lt(column, value) { filters.push(`${columnName(column)} < ?`); values.push(value); return this; },
      in(column, expected) { filters.push(`${columnName(column)} IN (${expected.map(() => "?").join(",")})`); values.push(...expected); return this; },
      order(column, options) { sorting.push(`${columnName(column)} ${options.ascending ? "ASC" : "DESC"}`); return this; },
      limit(value) { assert.ok(Number.isInteger(value) && value > 0 && value <= 21); limit = ` LIMIT ${value}`; return this; },
      then(resolve, reject) {
        return pool.execute(`SELECT t.*${join ? ", o.provider_id AS joined_provider_id" : ""} FROM \`${table}\` t${join ? " INNER JOIN order_aggregates o ON o.id = t.order_id" : ""} WHERE ${filters.join(" AND ")}${sorting.length ? ` ORDER BY ${sorting.join(",")}` : ""}${limit}`,
          values).then(([data]) => ({ data: join ? data.map((row) => ({ ...row, order_aggregates: { provider_id: row.joined_provider_id } })) : data, error: null })).then(resolve, reject);
      }
    };
  } };
}
test("verified notification and outgoing query reach database and actual buyer/provider payment states", async () => {
  const p = await reservePayment(pool, input(), now);
  const request = notificationFixture.notify(notificationFixture.transaction(result(p, { totalFen: 12000 })), now + 200);
  assert.equal((await acceptPaymentNotification(pool, request, notificationFixture.config, now + 200)).statusCode, 204);
  await seedOrder("order_2");
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid = ? WHERE provider_id = 'provider'", [queryFixture.config.platformMchid]);
  const normal = await reservePayment(pool, input({ orderId: "order_2", platformMchid: queryFixture.config.platformMchid }), now);
  const normalResponse = notificationFixture.sign(JSON.stringify(notificationFixture.transaction(result(normal))), now + 200);
  await queryPayment(pool, normal.id, queryFixture.config, queryFixture.requestFor(normalResponse), () => now + 200);
  await seedOrder("order_3");
  const closed = await reservePayment(pool, input({ orderId: "order_3", platformMchid: queryFixture.config.platformMchid }), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING') WHERE id = 'order_3'");
  await queryPayment(pool, closed.id, queryFixture.config, queryFixture.requestFor(queryResult(closed, "CLOSED")), () => now + 200);
  await seedOrder("order_4");
  const missing = await reservePayment(pool, input({ orderId: "order_4", platformMchid: queryFixture.config.platformMchid }), now);
  const missingData = notificationFixture.transaction(result(missing)); delete missingData.combine_payer_info;
  const missingResponse = notificationFixture.sign(JSON.stringify(missingData), now + 200);
  await queryPayment(pool, missing.id, queryFixture.config, queryFixture.requestFor(missingResponse), () => now + 200);
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
    const missingOrder = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_4" }, { WX_OPENID: openId }, contactKey);
    page.renderOrder(toClientOrder(missingOrder));
    assert.equal(page.data.order.paymentStatus, "PAYMENT_REVIEW");
    if (role === "BUYER") { assert.match(page.data.paymentHint, /付款信息或订单状态需要核对/); await page.startPayment(); }
    const paidOrder = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_2" }, { WX_OPENID: openId }, contactKey);
    page.renderOrder(toClientOrder(paidOrder));
    assert.equal(page.data.order.paymentStatus, "PAID");
    if (role === "BUYER") { assert.match(page.data.paymentHint, /付款已确认/); await page.startPayment(); }
    const unpaidOrder = await handleOrder(databaseReader(), { action: "getOrder", orderId: "order_3" }, { WX_OPENID: openId }, contactKey);
    page.renderOrder(toClientOrder(unpaidOrder));
    assert.equal(page.data.order.paymentStatus, "UNPAID");
    if (role === "BUYER") { assert.equal(page.data.agreementConfirmed, true); assert.match(page.data.paymentHint, /继续付款/); }
    else assert.equal(page.data.isWaitingBuyerConfirm, true);
  }
  await assert.rejects(handleOrder(databaseReader(), { action: "transitionOrder", orderId: "order_1", expectedVersion: 2, event: "BUYER_CONFIRMS_EXECUTION" },
    { WX_OPENID: "test_openid" }, contactKey), code("PAYMENT_NOT_VERIFIED"));
  await assert.rejects(handleOrder(databaseReader(), { action: "transitionOrder", orderId: "order_4", expectedVersion: 2, event: "BUYER_CONFIRMS_EXECUTION" },
    { WX_OPENID: "test_openid" }, contactKey), code("PAYMENT_NOT_VERIFIED"));
});

test("query missing payer preserves money for review once without inventing identity or auto-releasing review", async () => {
  const p = await reservePayment(pool, input(), now);
  const data = notificationFixture.transaction(result(p)); delete data.combine_payer_info;
  const response = notificationFixture.sign(JSON.stringify(data), now + 200);
  await assert.rejects(acceptPaymentQuery(faultyPool("write"), response, notificationFixture.config, p.id, now + 200), /injected order write failure/);
  assert.equal((await payments())[0].payer_verification, null);
  const read = () => acceptPaymentQuery(pool, response, notificationFixture.config, p.id, now + 200);
  const outcomes = await Promise.all(Array.from({ length: 10 }, read));
  assert.equal(outcomes.filter((item) => !item.duplicate).length, 1);
  const saved = (await payments())[0];
  assert.equal(saved.payer_verification, "MISSING");
  assert.equal(saved.payer_openid, "test_openid"); // Original reservation remains expected identity, never a claimed returned payer.
  assert.equal(saved.review_reason, "PAYER_NOT_RETURNED");
  assert.equal(Number(saved.received_total_fen), 10000);
  assert.equal(Number(saved.payer_paid_fen), 9800);
  assert.equal(saved.status, "PAID_REQUIRES_REVIEW");
  await acceptPaymentNotification(pool, notificationFixture.notify(notificationFixture.transaction(result(p)), now + 300), notificationFixture.config, now + 300);
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
  assert.equal((await payments())[0].payer_verification, "MISSING");
  const funds = await handleOrder(databaseReader(), { action: "getProviderFunds" }, { WX_OPENID: "test_provider_openid" }, contactKey);
  assert.equal(funds.records[0].status, "PAID_REQUIRES_REVIEW");
  assert.equal(JSON.stringify(funds).includes("test_openid"), false);
});

test("later missing-payer query cannot downgrade paid receipt and missing identity cannot be marked verified", async () => {
  const p = await reservePayment(pool, input(), now);
  await recordPaymentSuccess(pool, result(p), now + 200);
  const data = notificationFixture.transaction(result(p)); delete data.combine_payer_info;
  await acceptPaymentQuery(pool, notificationFixture.sign(JSON.stringify(data), now + 200), notificationFixture.config, p.id, now + 200);
  assert.equal((await payments())[0].payer_verification, "MATCHED");
  assert.equal((await payments())[0].status, "PAID");
  await assert.rejects(pool.query("UPDATE order_payments SET payer_verification = 'MISSING'"), code("ER_CHECK_CONSTRAINT_VIOLATED"));
  await assert.rejects(pool.query("UPDATE order_payments SET payer_verification = NULL"), code("ER_CHECK_CONSTRAINT_VIOLATED"));
  await assert.rejects(recordPaymentSuccess(pool, result(p, { payerOpenid: undefined }), now + 200), code("PAYMENT_RESULT_INVALID"));
  const wrong = notificationFixture.transaction(result(p, { payerOpenid: "wrong" }));
  await assert.rejects(acceptPaymentQuery(pool, notificationFixture.sign(JSON.stringify(wrong), now + 200), notificationFixture.config, p.id, now + 200), code("PAYMENT_RESULT_MISMATCH"));
});

test("unpaid observations never downgrade a received payment and present payer must match", async () => {
  const p = await reservePayment(pool, input(), now);
  const read = (state) => acceptPaymentQuery(pool, queryResult(p, state), notificationFixture.config, p.id, now + 200);
  assert.deepEqual(await read("NOTPAY"), { status: "CREATED", channelStatus: "NOTPAY" });
  assert.deepEqual(await read("PAYERROR"), { status: "CREATED", channelStatus: "PAYERROR" });
  assert.equal((await order()).version, 1);
  await recordPaymentSuccess(pool, result(p), now + 200);
  for (const state of ["NOTPAY", "PAYERROR", "CLOSED"]) assert.equal((await read(state)).status, "PAID");
  assert.equal((await order()).payload.public.paymentStatus, "PAID");
  assert.equal((await order()).version, 2);
  const wrong = JSON.parse(queryResult(p, "CLOSED").body); wrong.combine_payer_info = { openid: "wrong" };
  await assert.rejects(acceptPaymentQuery(pool, notificationFixture.sign(JSON.stringify(wrong), now + 200), notificationFixture.config, p.id, now + 200), code("PAYMENT_RESULT_MISMATCH"));
});

test("closed active payment restores unpaid once; an old close cannot clear a newer pending payment", async () => {
  const p = await reservePayment(pool, input(), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING')");
  const closed = queryResult(p, "CLOSED");
  const close = () => acceptPaymentQuery(pool, closed, notificationFixture.config, p.id, now + 200);
  await close(); await close();
  assert.equal((await order()).payload.public.paymentStatus, "UNPAID");
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
  const next = await reservePayment(pool, input({ expectedVersion: 2, requestKey: "request_after_closed" }), now + 200);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING')");
  await close();
  assert.equal((await order()).payload.public.paymentStatus, "VERIFYING");
  assert.equal((await order()).version, 2);
  await recordPaymentSuccess(pool, result(p), now + 300);
  await acceptPaymentQuery(pool, queryResult(next, "CLOSED"), notificationFixture.config, next.id, now + 300);
  assert.equal((await order()).payload.public.paymentStatus, "PAYMENT_REVIEW");
});

test("failure restoring an order after verified close rolls back the payment close too", async () => {
  const p = await reservePayment(pool, input(), now);
  await pool.query("UPDATE order_aggregates SET payload = JSON_SET(payload, '$.public.paymentStatus', 'VERIFYING')");
  await assert.rejects(acceptPaymentQuery(faultyPool("write"), queryResult(p, "CLOSED"), notificationFixture.config, p.id, now + 200), /injected order write failure/);
  assert.equal((await payments())[0].status, "CREATED");
  assert.equal((await order()).payload.public.paymentStatus, "VERIFYING");
  assert.equal((await order()).version, 1);
});

test("failed outgoing query preserves the order and payment; verified retry recovers once", async () => {
  await pool.execute("UPDATE provider_payment_merchants SET platform_mchid = ? WHERE provider_id = 'provider'", [queryFixture.config.platformMchid]);
  const p = await reservePayment(pool, input({ platformMchid: queryFixture.config.platformMchid }), now);
  const response = notificationFixture.sign(JSON.stringify(notificationFixture.transaction(result(p))), now + 200);
  for (const statusCode of [302, 404, 500]) {
    await assert.rejects(queryPayment(pool, p.id, queryFixture.config, queryFixture.requestFor({ ...response, statusCode }), () => now + 200), code("PAYMENT_QUERY_FAILED"));
  }
  assert.equal((await payments())[0].status, "CREATED");
  assert.equal((await order()).version, 1);
  assert.equal((await order()).payload.public.paymentStatus, "UNPAID");
  const recover = () => queryPayment(pool, p.id, queryFixture.config, queryFixture.requestFor(response), () => now + 200);
  const outcomes = await Promise.all(Array.from({ length: 10 }, recover));
  assert.equal(outcomes.filter((item) => !item.duplicate).length, 1);
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
});

test("20 signed notification retries acknowledge only one committed receipt", async () => {
  const p = await reservePayment(pool, input(), now);
  const request = notificationFixture.notify(notificationFixture.transaction(result(p)), now + 200);
  const responses = await Promise.all(Array.from({ length: 20 }, () => acceptPaymentNotification(pool, request, notificationFixture.config, now + 200)));
  assert.ok(responses.every((response) => response.statusCode === 204 && response.body === ""));
  assert.equal((await order()).version, 2);
  assert.equal((await order()).payload.events.length, 1);
});

test("invalid signature never writes, failed commit path can recover from a signed query", async () => {
  const p = await reservePayment(pool, input(), now);
  const transaction = notificationFixture.transaction(result(p));
  const request = notificationFixture.notify(transaction, now + 200);
  await assert.rejects(acceptPaymentNotification(pool, { ...request, body: Buffer.concat([request.body, Buffer.from(" ")]) }, notificationFixture.config, now + 200), code("PAYMENT_SIGNATURE_INVALID"));
  await assert.rejects(acceptPaymentNotification(faultyPool("write"), request, notificationFixture.config, now + 200), /injected order write failure/);
  assert.equal((await payments())[0].transaction_id, null);
  assert.equal((await order()).version, 1);
  const query = notificationFixture.sign(JSON.stringify(transaction), now + 200);
  assert.equal((await acceptPaymentQuery(pool, query, notificationFixture.config, p.id, now + 200)).status, "PAID");
  assert.equal((await acceptPaymentNotification(pool, request, notificationFixture.config, now + 200)).statusCode, 204);
  assert.equal((await order()).payload.events.length, 1);
});

test("notification commit acknowledgement loss is not falsely acknowledged and retry is safe", async () => {
  const p = await reservePayment(pool, input(), now);
  const request = notificationFixture.notify(notificationFixture.transaction(result(p)), now + 200);
  await assert.rejects(acceptPaymentNotification(faultyPool("ack"), request, notificationFixture.config, now + 200), /acknowledgement loss/);
  assert.equal((await acceptPaymentNotification(pool, request, notificationFixture.config, now + 200)).statusCode, 204);
  assert.equal((await order()).version, 2);
});

test("real receipts paginate through provider-only funds API and actual funds page", async () => {
  await pool.query("INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES ('other_provider','other_provider','TEST',1,1)");
  await pool.query("INSERT INTO provider_payment_merchants VALUES ('other_provider','test_platform','test_other_sub','READY',1)");
  await seedOrder("foreign_order", "other_provider");
  const foreign = await reservePayment(pool, input({ orderId: "foreign_order" }), now);
  await recordPaymentSuccess(pool, result(foreign));
  for (let i = 0; i < 23; i++) {
    const orderId = i === 0 ? "order_1" : `funds_order_${i}`;
    if (i) await seedOrder(orderId);
    const p = await reservePayment(pool, input({ orderId }), now);
    await recordPaymentSuccess(pool, result(p, i === 22 ? { totalFen: 12000 } : {}));
  }
  const call = (cursor = null) => handleOrder(databaseReader(), { action: "getProviderFunds", providerId: "stranger", cursor }, { WX_OPENID: "test_provider_openid" }, contactKey);
  const first = await call();
  const second = await call(first.nextCursor);
  assert.equal(first.records.length, 20); assert.equal(second.records.length, 3);
  assert.equal(new Set([...first.records, ...second.records].map((r) => r.id)).size, 23);
  assert.equal(second.nextCursor, null);
  assert.equal(first.withdrawableBalanceFen, null);
  assert.equal(JSON.stringify(first).includes("test_openid"), false);
  assert.equal(JSON.stringify(first).includes("transaction_id"), false);
  await assert.rejects(handleOrder(databaseReader(), { action: "getProviderFunds" }, { WX_OPENID: "test_openid" }, contactKey), code("PROVIDER_ROLE_REQUIRED"));
  let definition;
  global.Page = (value) => { definition = value; };
  require("../miniprogram/pages/funds/index");
  delete global.Page;
  const page = { data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  definition.renderResponse.call(page, first, false);
  definition.renderResponse.call(page, second, true);
  assert.equal(page.data.records.length, 23);
  assert.ok(page.data.records.some((r) => r.statusText === "付款待核对"));
});
