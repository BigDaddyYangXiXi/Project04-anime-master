const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handlePaymentHttp } = require("./payment-http");
const { createNotificationFixture } = require("./test-notification-fixture");
const fixture = createNotificationFixture(), now = 1788777600000;
const payment = { combineOutTradeNo: "a".repeat(32), outTradeNo: "a".repeat(32), appid: "test_app", platformMchid: "test_platform",
  subMchid: "test_sub", payerOpenid: "test_openid", transactionId: "test_transaction", totalFen: 10000, payerPaidFen: 9800, currency: "CNY", paidAt: now - 1000 };
const signed = fixture.notify(fixture.transaction(payment), now, { summary: "订单支付成功" });
const event = (base64 = false) => ({ httpMethod: "POST", headers: signed.headers, body: signed.body.toString(base64 ? "base64" : "utf8"), isBase64Encoded: base64 });
const noDatabase = { getConnection: async () => assert.fail("invalid input must never reach database") };
const run = (input, pool = noDatabase, config = fixture.config, log = () => {}) => handlePaymentHttp(pool, input, config, now, log);

test("HTTP adapter accepts only POST and returns explicit failure status instead of RPC success", async () => {
  for (const input of [undefined, {}, { method: "POST" }, { httpMethod: "GET" }, { httpMethod: "post" }]) {
    const result = await run(input);
    assert.equal(result.statusCode, 405); assert.equal(result.headers.Allow, "POST");
    assert.equal(JSON.parse(result.body).code, "FAIL");
  }
});

test("plain and base64 bodies preserve signatures and propagate database failure as HTTP 500", async () => {
  let calls = 0;
  const pool = { getConnection: async () => { calls++; throw new Error("database offline"); } };
  for (const base64 of [false, true]) assert.equal((await run(event(base64), pool)).statusCode, 500);
  assert.equal(calls, 2);
});

test("parsed objects, invalid encoding flags and noncanonical base64 fail before database", async () => {
  for (const body of [JSON.parse(signed.body), null, undefined, Buffer.from(signed.body)]) assert.equal((await run({ ...event(), body })).statusCode, 400);
  for (const isBase64Encoded of ["false", "true", null, 1]) assert.equal((await run({ ...event(), isBase64Encoded })).statusCode, 400);
  for (const body of ["", "not base64", "YWJj\n", "YR=="]) assert.equal((await run({ ...event(true), body })).statusCode, 400);
});

test("body and headers are bounded, ambiguous headers and compressed content are rejected", async () => {
  assert.equal((await run({ ...event(), body: "a".repeat(2 * 1024 * 1024 + 1) })).statusCode, 413);
  assert.equal((await run({ ...event(true), body: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64") })).statusCode, 413);
  for (const patch of [{ headers: null }, { headers: { ...signed.headers, "Wechatpay-Nonce": ["one", "two"] } }, { multiValueHeaders: {} },
    { headers: { ...signed.headers, "Content-Encoding": "gzip" } }]) assert.equal((await run({ ...event(), ...patch })).statusCode, 400);
});

test("tampered bytes, duplicate signature names and stale signatures produce non-success HTTP responses", async () => {
  assert.equal((await run({ ...event(), body: event().body + " " })).statusCode, 403);
  assert.equal((await run({ ...event(), headers: { ...signed.headers, "wechatpay-signature": signed.headers["Wechatpay-Signature"] } })).statusCode, 403);
  assert.equal((await handlePaymentHttp(noDatabase, event(), fixture.config, now + 301000, () => {})).statusCode, 403);
  assert.equal((await run(event(), noDatabase, { ...fixture.config, publicKeys: new Map() })).statusCode, 503);
});

test("HTTP response and logs omit SQL, request data, payment identities and unknown exception codes", async () => {
  const logs = [];
  const pool = { getConnection: async () => { const error = new Error("secret SQL test_openid"); error.code = "SECRET_DATABASE_ERROR"; throw error; } };
  const result = await run(event(), pool, fixture.config, (value) => logs.push(value));
  assert.equal(result.statusCode, 500);
  assert.deepEqual(logs.map(JSON.parse), [{ scope: "payment-http", code: "PAYMENT_INTERNAL_ERROR" }]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal((await run(event(), pool, fixture.config, () => { throw new Error("logger unavailable"); })).statusCode, 500);
});
