const { test } = require("node:test");
const assert = require("node:assert/strict");
const { verifyMessage, decryptNotification, normalizeCombineSuccess, normalizeCombineQuery } = require("./wechat-verification");
const { acceptPaymentNotification, acceptPaymentQuery } = require("./payment-notifications");
const { createNotificationFixture } = require("./test-notification-fixture");
const fixture = createNotificationFixture(), now = 1788616800000;
const payment = { tradeState: "SUCCESS", combineOutTradeNo: "a".repeat(32), outTradeNo: "a".repeat(32), appid: "test_app", platformMchid: "test_platform",
  subMchid: "test_sub", payerOpenid: "test_openid", transactionId: "test_transaction", totalFen: 10000, payerPaidFen: 9800, currency: "CNY", paidAt: now - 1234 };
const code = (expected) => (error) => error.code === expected;

test("unpaid query preserves absent payer and permits absent trade type without inventing receipt fields", () => {
  for (const trade_state of ["NOTPAY", "CLOSED", "PAYERROR"]) {
    const data = fixture.transaction(payment);
    delete data.combine_payer_info;
    data.sub_orders = [{ mchid: payment.platformMchid, sub_mchid: payment.subMchid, out_trade_no: payment.outTradeNo, trade_state }];
    const normalized = normalizeCombineQuery(data);
    assert.equal(normalized.tradeState, trade_state);
    assert.equal(Object.hasOwn(normalized, "payerOpenid"), false);
    assert.equal(Object.hasOwn(normalized, "totalFen"), false);
    data.combine_payer_info = { openid: "different_payer" };
    assert.equal(normalizeCombineQuery(data).payerOpenid, "different_payer");
    data.combine_payer_info.openid = null;
    assert.throws(() => normalizeCombineQuery(data), code("PAYMENT_MESSAGE_INVALID"));
  }
});

test("optional payer is limited to unpaid query states and never relaxes a success notification", () => {
  const data = fixture.transaction(payment); delete data.combine_payer_info;
  assert.throws(() => normalizeCombineQuery(data), code("PAYMENT_MESSAGE_INVALID"));
  data.sub_orders[0].trade_state = "CLOSED"; data.sub_orders[0].trade_type = "NATIVE";
  assert.throws(() => normalizeCombineQuery(data), code("PAYMENT_MESSAGE_INVALID"));
  delete data.sub_orders[0].trade_type; delete data.sub_orders[0].sub_mchid;
  assert.throws(() => normalizeCombineQuery(data), code("PAYMENT_MESSAGE_INVALID"));
});

test("illustrative documentation key and signature are not blindly accepted as a valid test vector", () => {
  // This copied public example combination does not verify; retain rejection rather than bypass verification.
  // Never configured as a production merchant key. A valid independent official test vector remains pending.
  // Source: https://pay.wechatpay.cn/doc/v3/merchant/4013053249
  const serial = "PUB_KEY_ID_0000000000000024101100397200000006";
  const publicKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4zej1cqugGQtVSY2Ah8RMCKcr2UpZ8Npo+5Ja9xpFPYkWHaF1Gjrn3d5kcwAFuHHcfdc3yxDYx6+9grvJnCA2zQzWjzVRa3BJ5LTMj6yqvhEmtvjO9D1xbFTA2m3kyjxlaIar/RYHZSslT4VmjIatW9KJCDKkwpM6x/RIWL8wwfFwgz2q3Zcrff1y72nB8p8P12ndH7GSLoY6d2Tv0OB2+We2Kyy2+QzfGXOmLp7UK/pFQjJjzhSf9jxaWJXYKIBxpGlddbRZj9PqvFPTiep8rvfKGNZF9Q6QaMYTpTp/uKQ3YvpDlyeQlYe4rRFauH3mOE6j56QlYQWivknDX9VrwIDAQAB\n-----END PUBLIC KEY-----";
  const headers = { "Wechatpay-Serial": serial, "Wechatpay-Timestamp": "1722850421", "Wechatpay-Nonce": "d824f2e086d3c1df967785d13fcd22ef",
    "Wechatpay-Signature": "mfI1CPqvBrgcXfgXMFjdNIhBf27ACE2YyeWsWV9ZI7T7RU0vHvbQpu9Z32ogzc+k8ZC5n3kz7h70eWKjgqNdKQF0eRp8mVKlmfzMLBVHbssB9jEZEDXThOX1XFqX7s7ymia1hoHQxQagPGzkdWxtlZPZ4ZPvr1RiqkgAu6Is8MZgXXrRoBKqjmSdrP1N7uxzJ/cjfSiis9FiLjuADoqmQ1P7p2N876YPAol7Rn0+GswwAwxldbdLrmVSjfytfSBJFqTMHn4itojgxSWWN1byuckQt8hSTEv/Lg97QoeGniYP17T80pJeQyL3b+295FPHSO2AtvCgyIbKMZ0BALilAA==" };
  const body = '{"code_url":"weixin://wxpay/bizpayurl?pr=JyC91EIz1"}';
  assert.throws(() => verifyMessage(body, headers, { publicKeys: new Map([[serial, publicKey]]) }, 1722850421000), code("PAYMENT_SIGNATURE_INVALID"));
});

test("signed encrypted raw notification normalizes the correct combine amount fields", () => {
  const request = fixture.notify(fixture.transaction(payment), now);
  const decrypted = decryptNotification(request.body, request.headers, fixture.config, now);
  assert.deepEqual(normalizeCombineSuccess(decrypted.transaction), payment);
  const lower = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]));
  assert.deepEqual(decryptNotification(request.body, lower, fixture.config, now), decrypted);
});
test("raw byte tampering, reserialized JSON and fabricated signatures are rejected", () => {
  const request = fixture.notify(fixture.transaction(payment), now);
  for (const body of [Buffer.concat([request.body, Buffer.from(" ")]), Buffer.from(JSON.stringify(JSON.parse(request.body), null, 2))]) {
    assert.throws(() => verifyMessage(body, request.headers, fixture.config, now), code("PAYMENT_SIGNATURE_INVALID"));
  }
  assert.throws(() => verifyMessage(JSON.parse(request.body), request.headers, fixture.config, now), code("PAYMENT_RAW_BODY_REQUIRED"));
  for (const signature of ["WECHATPAY/SIGNTEST/invalid", "AAAA", ""]) {
    assert.throws(() => verifyMessage(request.body, { ...request.headers, "Wechatpay-Signature": signature }, fixture.config, now), code("PAYMENT_SIGNATURE_INVALID"));
  }
});
test("signature timestamps reject expired and future messages while allowing bounded retries", () => {
  for (const seconds of [-301, 301]) {
    const request = fixture.notify(fixture.transaction(payment), now + seconds * 1000);
    assert.throws(() => verifyMessage(request.body, request.headers, fixture.config, now), code("PAYMENT_SIGNATURE_EXPIRED"));
  }
  const request = fixture.notify(fixture.transaction(payment), now - 300000);
  assert.ok(verifyMessage(request.body, request.headers, fixture.config, now));
});

test("an empty signed response is verifiable but cannot become a payment notification", () => {
  const response = fixture.sign("", now);
  assert.equal(verifyMessage(response.body, response.headers, fixture.config, now).length, 0);
  assert.throws(() => decryptNotification(response.body, response.headers, fixture.config, now), code("PAYMENT_MESSAGE_INVALID"));
});
test("unknown or duplicated key headers and unconfigured keys cannot verify", () => {
  const request = fixture.notify(fixture.transaction(payment), now);
  assert.throws(() => verifyMessage(request.body, { ...request.headers, "Wechatpay-Serial": "PUB_KEY_ID_9999999999" }, fixture.config, now), code("PAYMENT_UNKNOWN_KEY"));
  assert.throws(() => verifyMessage(request.body, { ...request.headers, "wechatpay-serial": request.headers["Wechatpay-Serial"] }, fixture.config, now), code("PAYMENT_SIGNATURE_INVALID"));
  assert.throws(() => verifyMessage(request.body, request.headers, {}, now), code("PAYMENT_VERIFIER_NOT_CONFIGURED"));
});
test("signed but damaged ciphertext, wrong API key and altered associated data cannot decrypt", () => {
  const request = fixture.notify(fixture.transaction(payment), now);
  assert.throws(() => decryptNotification(request.body, request.headers, { ...fixture.config, apiV3Key: Buffer.alloc(32) }, now), code("PAYMENT_DECRYPTION_FAILED"));
  const envelope = JSON.parse(request.body);
  for (const patch of [{ associated_data: "altered" }, { ciphertext: Buffer.alloc(32).toString("base64") }]) {
    const signed = fixture.sign(JSON.stringify({ ...envelope, resource: { ...envelope.resource, ...patch } }), now);
    assert.throws(() => decryptNotification(signed.body, signed.headers, fixture.config, now), code("PAYMENT_DECRYPTION_FAILED"));
  }
});
test("unsupported events and algorithms never reach payment persistence", async () => {
  let acquired = false;
  const pool = { async getConnection() { acquired = true; throw new Error("must not write"); } };
  const request = fixture.notify(fixture.transaction(payment), now, { event_type: "REFUND.SUCCESS" });
  await assert.rejects(acceptPaymentNotification(pool, request, fixture.config, now), code("PAYMENT_EVENT_UNSUPPORTED"));
  const envelope = JSON.parse(fixture.notify(fixture.transaction(payment), now).body);
  envelope.resource.algorithm = "unsupported";
  await assert.rejects(acceptPaymentNotification(pool, fixture.sign(JSON.stringify(envelope), now), fixture.config, now), code("PAYMENT_MESSAGE_INVALID"));
  assert.equal(acquired, false);
  assert.equal((await acceptPaymentNotification(pool, { method: "GET" }, fixture.config, now)).statusCode, 405);
});
test("missing merchant, payer, legacy amount fields and unsupported multi-order results fail closed", () => {
  const source = fixture.transaction(payment);
  for (const change of [
    (data) => { delete data.sub_orders[0].sub_mchid; },
    (data) => { delete data.combine_payer_info; },
    (data) => { data.sub_orders[0].mchid = "wrong"; },
    (data) => { data.sub_orders[0].amount = { total: 10000, payer_total: 9800, currency: "CNY", payer_currency: "CNY" }; },
    (data) => { data.sub_orders[0].amount.total_amount = "10000"; },
    (data) => { data.sub_orders[0].success_time = "2026-09-05 21:00:00"; },
    (data) => { data.sub_orders[0].success_time = "2026-02-30T21:00:00+08:00"; }
  ]) {
    const data = structuredClone(source); change(data);
    assert.throws(() => normalizeCombineSuccess(data), code("PAYMENT_MESSAGE_INVALID"));
  }
  assert.throws(() => normalizeCombineSuccess({ ...source, sub_orders: [...source.sub_orders, ...source.sub_orders] }), code("PAYMENT_SUBORDERS_UNSUPPORTED"));
  source.sub_orders[0].amount.payer_currency = "USD";
  assert.throws(() => normalizeCombineSuccess(source), code("PAYMENT_CURRENCY_UNSUPPORTED"));
});
test("query responses must be signed, successful and bound to the requested payment", async () => {
  let acquired = false;
  const pool = { async getConnection() { acquired = true; throw new Error("must not write"); } };
  const response = fixture.sign(JSON.stringify(fixture.transaction(payment)), now);
  await assert.rejects(acceptPaymentQuery(pool, { ...response, statusCode: 500 }, fixture.config, payment.outTradeNo, now), code("PAYMENT_QUERY_FAILED"));
  await assert.rejects(acceptPaymentQuery(pool, response, fixture.config, "b".repeat(32), now), code("PAYMENT_QUERY_MISMATCH"));
  await assert.rejects(acceptPaymentQuery(pool, { ...response, body: Buffer.concat([response.body, Buffer.from(" ")]) }, fixture.config, payment.outTradeNo, now), code("PAYMENT_SIGNATURE_INVALID"));
  assert.equal(acquired, false);
});
