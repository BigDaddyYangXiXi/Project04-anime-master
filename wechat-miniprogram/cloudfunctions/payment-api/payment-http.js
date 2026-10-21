const { acceptPaymentNotification } = require("./payment-notifications");

const badRequest = new Set(["PAYMENT_HTTP_BODY_INVALID", "PAYMENT_HTTP_HEADERS_INVALID", "PAYMENT_HTTP_MULTI_HEADERS_INVALID", "PAYMENT_HTTP_HEADER_VALUE_INVALID", "PAYMENT_HTTP_ENCODING_UNSUPPORTED",
  "PAYMENT_RAW_BODY_REQUIRED", "PAYMENT_MESSAGE_INVALID", "PAYMENT_EVENT_UNSUPPORTED", "PAYMENT_SUBORDERS_UNSUPPORTED", "PAYMENT_CURRENCY_UNSUPPORTED"]);
const forbidden = new Set(["PAYMENT_SIGNATURE_INVALID", "PAYMENT_SIGNATURE_EXPIRED", "PAYMENT_DECRYPTION_FAILED"]);
const unavailable = new Set(["PAYMENT_VERIFIER_NOT_CONFIGURED", "PAYMENT_UNKNOWN_KEY"]);
const persistence = new Set(["PAYMENT_NOT_FOUND", "ORDER_NOT_FOUND", "PAYMENT_RESULT_MISMATCH", "PAYMENT_RESULT_CONFLICT", "PAYMENT_RESULT_INVALID"]);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function response(statusCode) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    ...(statusCode === 405 ? { Allow: "POST" } : {}) },
  isBase64Encoded: false, body: statusCode === 204 ? "" : JSON.stringify({ code: "FAIL", message: "通知未处理，请稍后重试" }) };
}

function rawRequest(event) {
  if (!event.headers || typeof event.headers !== "object" || Array.isArray(event.headers)) fail("PAYMENT_HTTP_HEADERS_INVALID");
  if (event.multiValueHeaders !== undefined) {
    const multi = event.multiValueHeaders;
    if (!multi || typeof multi !== "object" || Array.isArray(multi)) fail("PAYMENT_HTTP_MULTI_HEADERS_INVALID");
    const seen = new Set();
    for (const [key, values] of Object.entries(multi)) {
      const name = key.toLowerCase();
      const matches = Object.entries(event.headers).filter(([single]) => single.toLowerCase() === name);
      // CloudBase can include both maps; accept only an identical, unambiguous single value.
      if (seen.has(name) || !Array.isArray(values) || values.length !== 1 || typeof values[0] !== "string"
        || matches.length !== 1 || matches[0][1] !== values[0]) fail("PAYMENT_HTTP_MULTI_HEADERS_INVALID");
      seen.add(name);
    }
  }
  let encoding;
  for (const [key, value] of Object.entries(event.headers)) {
    if (typeof value !== "string") fail("PAYMENT_HTTP_HEADER_VALUE_INVALID");
    if (key.toLowerCase() === "content-encoding") {
      if (encoding !== undefined) fail("PAYMENT_HTTP_HEADERS_INVALID");
      encoding = value;
    }
  }
  if (encoding !== undefined && encoding !== "identity") fail("PAYMENT_HTTP_ENCODING_UNSUPPORTED");
  if (typeof event.body !== "string" || event.isBase64Encoded !== undefined && typeof event.isBase64Encoded !== "boolean") fail("PAYMENT_HTTP_BODY_INVALID");
  let body;
  if (event.isBase64Encoded) {
    if (event.body.length > 2796204) fail("PAYMENT_HTTP_TOO_LARGE");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(event.body) || event.body.length % 4) fail("PAYMENT_HTTP_BODY_INVALID");
    body = Buffer.from(event.body, "base64");
    if (body.toString("base64") !== event.body) fail("PAYMENT_HTTP_BODY_INVALID");
  } else {
    if (Buffer.byteLength(event.body, "utf8") > 2 * 1024 * 1024) fail("PAYMENT_HTTP_TOO_LARGE");
    body = Buffer.from(event.body, "utf8");
  }
  if (!body.length) fail("PAYMENT_HTTP_BODY_INVALID");
  if (body.length > 2 * 1024 * 1024) fail("PAYMENT_HTTP_TOO_LARGE");
  return { method: "POST", headers: event.headers, body };
}

// CloudBase ordinary-function HTTP integration response, not a client RPC success envelope.
// Production activation requires gateway byte preservation and verified merchant configuration.
async function handlePaymentHttp(pool, event, config, now = Date.now(), log = console.error, accept = acceptPaymentNotification) {
  if (!event || event.httpMethod !== "POST") return response(405);
  try {
    await accept(pool, rawRequest(event), config, now);
    return response(204);
  } catch (error) {
    const code = error && error.code;
    const status = code === "PAYMENT_HTTP_TOO_LARGE" ? 413 : badRequest.has(code) ? 400
      : forbidden.has(code) ? 403 : unavailable.has(code) ? 503 : 500;
    const safeCode = badRequest.has(code) || forbidden.has(code) || unavailable.has(code) || persistence.has(code) || code === "PAYMENT_HTTP_TOO_LARGE"
      ? code : "PAYMENT_INTERNAL_ERROR";
    // Do not log original errors, SQL, payment identities, authorization headers or request bodies.
    try { log(JSON.stringify({ scope: "payment-http", code: safeCode })); } catch { /* Logging must not replace the failed HTTP acknowledgement. */ }
    const reply = response(status);
    // Allow gateway diagnostics even when cloud log storage is unavailable. Whitelisted codes only.
    reply.headers['X-Payment-Error'] = safeCode;
    return reply;
  }
}

function handleRefundHttp(pool, event, config, now = Date.now(), log = console.error) {
  return handlePaymentHttp(pool, event, config, now, log, require('./refund-notifications').acceptRefundNotification);
}
module.exports = { handlePaymentHttp, handleRefundHttp };
