const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { buildQueryRequest, queryPayment } = require("./wechat-query");
const { createNotificationFixture } = require("./test-notification-fixture");
const { createQueryFixture } = require("./test-query-fixture");
const notification = createNotificationFixture(), fixture = createQueryFixture(notification.config);
const id = "a".repeat(32), now = 1788675600000;
const payment = { combineOutTradeNo: id, outTradeNo: id, appid: "test_app", platformMchid: fixture.config.platformMchid,
  subMchid: "test_sub", payerOpenid: "test_openid", transactionId: "test_transaction", totalFen: 10000, payerPaidFen: 9800, currency: "CNY", paidAt: now - 1000 };
const signed = () => notification.sign(JSON.stringify(notification.transaction(payment)), now);
const code = (expected) => (error) => error.code === expected;
const pool = { execute: async () => [[{ platform_mchid: fixture.config.platformMchid }]], getConnection: async () => { throw new Error("verified_database_boundary"); } };
const query = (response, stream) => queryPayment(pool, id, fixture.config, fixture.requestFor(response, () => {}, stream), () => now);

test("GET signature covers exact path and empty body with distinct merchant certificate and WeChat key IDs", () => {
  const request = buildQueryRequest(id, fixture.config, now);
  const fields = Object.fromEntries([...request.headers.Authorization.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  assert.ok(request.headers.Authorization.startsWith("WECHATPAY2-SHA256-RSA2048 "));
  assert.equal(fields.serial_no, fixture.config.merchantSerial);
  assert.equal(request.headers["Wechatpay-Serial"], fixture.config.wechatPublicKeyId);
  assert.equal(fields.mchid, fixture.config.platformMchid);
  assert.equal(fields.timestamp, String(now / 1000));
  const message = Buffer.from(`GET\n/v3/combine-transactions/out-trade-no/${id}\n${fields.timestamp}\n${fields.nonce_str}\n\n`);
  assert.equal(crypto.verify("RSA-SHA256", message, fixture.publicKey, Buffer.from(fields.signature, "base64")), true);
  assert.equal(crypto.verify("RSA-SHA256", message.subarray(0, -1), fixture.publicKey, Buffer.from(fields.signature, "base64")), false);
  assert.notEqual(buildQueryRequest(id, fixture.config, now).headers.Authorization, request.headers.Authorization);
});

test("invalid IDs, credentials and key mode are rejected before constructing a request", () => {
  for (const bad of ["../other", `${id}?x=1`, "https://example.com", "", undefined]) assert.throws(() => buildQueryRequest(bad, fixture.config), code("PAYMENT_INPUT_INVALID"));
  for (const patch of [{ platformMchid: '1"\r\nHost:evil' }, { merchantSerial: fixture.config.wechatPublicKeyId }, { merchantPrivateKey: "bad" },
    { wechatPublicKeyId: fixture.config.merchantSerial }, { publicKeys: new Map() }, { merchantPrivateKey: crypto.generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }) }]) {
    assert.throws(() => buildQueryRequest(id, { ...fixture.config, ...patch }), code("PAYMENT_QUERY_NOT_CONFIGURED"));
  }
});

test("missing or foreign merchant payment cannot cause an outgoing query", async () => {
  const request = () => assert.fail("must not send");
  await assert.rejects(queryPayment({ execute: async () => [[]] }, id, fixture.config, request), code("PAYMENT_NOT_FOUND"));
  await assert.rejects(queryPayment(pool, id, { ...fixture.config, platformMchid: "1999999999" }, request), code("PAYMENT_QUERY_MERCHANT_MISMATCH"));
});

test("fixed TLS transport retains split response bytes until verified and then enters the receipt transaction", async () => {
  const response = signed();
  const request = fixture.requestFor(response, (options) => {
    assert.equal(options.hostname, "api.mch.weixin.qq.com"); assert.equal(options.protocol, "https:"); assert.equal(options.port, 443);
    assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false); assert.equal(options.minVersion, "TLSv1.2");
    assert.equal(options.method, "GET"); assert.equal(options.headers["Accept-Encoding"], "identity");
    assert.equal(options.headers["User-Agent"], "Wanjiangwu-Payment/1.0");
  }, (incoming) => { incoming.write(response.body.subarray(0, 11)); incoming.end(response.body.subarray(11)); });
  await assert.rejects(queryPayment(pool, id, { ...fixture.config, hostname: "evil.example" }, request, () => now), /verified_database_boundary/);
});

test("redirects and non-200 responses never infer payment failure or close a payment", async () => {
  for (const statusCode of [204, 301, 302, 400, 401, 404, 429, 500]) await assert.rejects(query({ ...signed(), statusCode }), code("PAYMENT_QUERY_FAILED"));
});

test('only a signed ORDERNOTEXIST is classified as absent without changing the reservation', async () => {
  const missing = { ...notification.sign(JSON.stringify({code:'ORDERNOTEXIST',message:'private upstream message'}),now),statusCode:404 };
  await assert.rejects(query(missing),code('PAYMENT_CHANNEL_ORDER_NOT_FOUND'));
  await assert.rejects(query({...missing,headers:{}}));
  const tampered={...missing,body:Buffer.from('{"code":"OTHER"}')};
  await assert.rejects(query(tampered),code('PAYMENT_SIGNATURE_INVALID'));
  for(const body of ['{','null','{"code":"NOAUTH"}']) {
    await assert.rejects(query({...notification.sign(body,now),statusCode:404}),code('PAYMENT_QUERY_FAILED'));
  }
});

test('DIRECT recognizes the documented ORDER_NOT_EXIST only after signature verification', async () => {
  const directPool = { execute: async () => [[{ platform_mchid: fixture.config.platformMchid, payment_mode: 'DIRECT' }]],
    getConnection: async () => assert.fail('absence must not mutate the reservation') };
  const missing = { ...notification.sign(JSON.stringify({ code: 'ORDER_NOT_EXIST' }), now), statusCode: 404 };
  await assert.rejects(queryPayment(directPool, id, fixture.config, fixture.requestFor(missing), () => now), code('PAYMENT_CHANNEL_ORDER_NOT_FOUND'));
  await assert.rejects(queryPayment(directPool, id, fixture.config, fixture.requestFor({ ...missing, headers: {} }), () => now), code('PAYMENT_SIGNATURE_INVALID'));
});

test("duplicate signature headers, altered bytes and encoded bodies cannot reach the database", async () => {
  const response = signed();
  await assert.rejects(query({ ...response, rawHeaders: [...Object.entries(response.headers).flat(), "wechatpay-signature", response.headers["Wechatpay-Signature"]] }), code("PAYMENT_QUERY_HEADERS_INVALID"));
  await assert.rejects(query({ ...response, body: Buffer.concat([response.body, Buffer.from(" ")]) }), code("PAYMENT_SIGNATURE_INVALID"));
  await assert.rejects(query({ ...response, headers: { ...response.headers, "Content-Encoding": "gzip" } }), code("PAYMENT_QUERY_ENCODING_UNSUPPORTED"));
  await assert.rejects(query({ ...response, body: Buffer.alloc(2 * 1024 * 1024 + 1) }), code("PAYMENT_QUERY_TOO_LARGE"));
});

test("partial response and connection errors are bounded generic failures without upstream secrets", async () => {
  await assert.rejects(query(signed(), (incoming) => incoming.destroy()), code("PAYMENT_QUERY_TRANSPORT_FAILED"));
  const request = () => {
    const client = new EventEmitter(); client.destroy = () => {};
    client.end = () => queueMicrotask(() => client.emit("error", new Error("sensitive upstream body")));
    return client;
  };
  await assert.rejects(queryPayment(pool, id, fixture.config, request, () => now), code("PAYMENT_QUERY_TRANSPORT_FAILED"));
});

test("absolute deadline includes connection setup rather than only socket inactivity", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let client;
  const request = () => { client = new EventEmitter(); client.end = () => {}; client.destroy = () => { client.destroyed = true; }; return client; };
  const pending = queryPayment(pool, id, fixture.config, request, () => now);
  const rejected = assert.rejects(pending, code("PAYMENT_QUERY_TIMEOUT"));
  await Promise.resolve();
  t.mock.timers.tick(8000);
  await rejected;
  assert.equal(client.destroyed, true);
});

test("unsupported states and mismatched query IDs fail; verified supported states enter persistence", async () => {
  for (const trade_state of ["USERPAYING", "REFUND", "UNKNOWN"]) {
    const data = notification.transaction(payment); data.sub_orders[0].trade_state = trade_state;
    await assert.rejects(query(notification.sign(JSON.stringify(data), now)), code("PAYMENT_EVENT_UNSUPPORTED"));
  }
  for (const trade_state of ["NOTPAY", "CLOSED", "PAYERROR"]) {
    const data = notification.transaction(payment); data.sub_orders[0].trade_state = trade_state;
    delete data.combine_payer_info; delete data.sub_orders[0].amount; delete data.sub_orders[0].trade_type;
    await assert.rejects(query(notification.sign(JSON.stringify(data), now)), /verified_database_boundary/);
  }
  const data = notification.transaction({ ...payment, combineOutTradeNo: "b".repeat(32) });
  await assert.rejects(query(notification.sign(JSON.stringify(data), now)), code("PAYMENT_QUERY_MISMATCH"));
});
