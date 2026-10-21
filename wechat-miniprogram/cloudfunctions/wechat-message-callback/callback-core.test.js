const assert = require("node:assert/strict");
const test = require("node:test");
const {
  decryptWechatMessage,
  normalizeMediaCheck,
  sha1Signature,
  verifyEncryptedSignature,
  verifyPlainSignature
} = require("./callback-core");

test("a provider error cannot approve an image even when suggest says pass", () => {
  for (const errcode of [1, -1, "invalid", null, false]) {
    const result = normalizeMediaCheck({ Event: "wxa_media_check", trace_id: "trace", errcode, result: { suggest: "pass" } });
    assert.equal(result.status, "ERROR");
    assert.equal(result.assetStatus, "REJECTED");
  }
  assert.equal(normalizeMediaCheck({ Event: "wxa_media_check", trace_id: "trace", errcode: 0, result: { suggest: "pass" } }).status, "PASS");
});

test("plain handshake signature is sorted before sha1", () => {
  const signature = sha1Signature(["token123", "1714112445", "415670741"]);
  assert.equal(verifyPlainSignature("token123", "1714112445", "415670741", signature), true);
  assert.equal(verifyPlainSignature("token123", "1714112445", "415670741", "bad"), false);
});

test("official secure JSON example verifies and decrypts", () => {
  const encrypted = "+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=";
  assert.equal(verifyEncryptedSignature(
    "AAAAA", "1714112445", "415670741", encrypted,
    "046e02f8204d34f8ba5fa3b1db94908f3df2e9b3"
  ), true);
  const message = JSON.parse(decryptWechatMessage(
    encrypted,
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "wxba5fad812f8e6fb9"
  ));
  assert.equal(message.Event, "debug_demo");
  assert.equal(message.debug_str, "hello world");
});

test("secure message rejects a different app id", () => {
  const encrypted = "+qdx1OKCy+5JPCBFWw70tm0fJGb2Jmeia4FCB7kao+/Q5c/ohsOzQHi8khUOb05JCpj0JB4RvQMkUyus8TPxLKJGQqcvZqzDpVzazhZv6JsXUnnR8XGT740XgXZUXQ7vJVnAG+tE8NUd4yFyjPy7GgiaviNrlCTj+l5kdfMuFUPpRSrfMZuMcp3Fn2Pede2IuQrKEYwKSqFIZoNqJ4M8EajAsjLY2km32IIjdf8YL/P50F7mStwntrA2cPDrM1kb6mOcfBgRtWygb3VIYnSeOBrebufAlr7F9mFUPAJGj04=";
  assert.throws(() => decryptWechatMessage(
    encrypted,
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "wx57412ad07a806b70"
  ), /APP_ID_MISMATCH/);
});

test("media check result maps pass and risky states", () => {
  assert.deepEqual(normalizeMediaCheck({
    Event: "wxa_media_check",
    trace_id: "trace-pass",
    result: { suggest: "pass", label: 100 },
    detail: []
  }), {
    traceId: "trace-pass",
    status: "PASS",
    assetStatus: "READY",
    label: 100,
    detail: []
  });
  assert.equal(normalizeMediaCheck({
    Event: "wxa_media_check",
    trace_id: "trace-risky",
    result: { suggest: "risky", label: 20001 }
  }).assetStatus, "REJECTED");
});

test("unknown and inherited result names cannot become database verdicts", () => {
  for (const suggest of ["__proto__", "constructor", "toString", "unknown", ""]) {
    const result = normalizeMediaCheck({ Event: "wxa_media_check", trace_id: "trace-unknown", result: { suggest } });
    assert.equal(result.status, "ERROR");
    assert.equal(result.assetStatus, "REJECTED");
  }
});
