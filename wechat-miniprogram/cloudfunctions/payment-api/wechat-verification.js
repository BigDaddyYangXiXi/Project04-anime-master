const crypto = require("node:crypto");

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function object(value) { if (!value || typeof value !== "object" || Array.isArray(value)) fail("PAYMENT_MESSAGE_INVALID"); return value; }
function token(value, max = 128) {
  if (typeof value !== "string" || !value.length || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) fail("PAYMENT_MESSAGE_INVALID");
  return value;
}
function base64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4) fail("PAYMENT_MESSAGE_INVALID");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) fail("PAYMENT_MESSAGE_INVALID");
  return decoded;
}
function parse(body) {
  try { return object(JSON.parse(body.toString("utf8"))); } catch { fail("PAYMENT_MESSAGE_INVALID"); }
}

// Verify original bytes before JSON parsing. Keys are provisioned by the operator, never by the request.
function verifyMessage(rawBody, headers, config, now = Date.now()) {
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string") fail("PAYMENT_RAW_BODY_REQUIRED");
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  if (body.length > 2 * 1024 * 1024) fail("PAYMENT_MESSAGE_INVALID");
  if (!config || !(config.publicKeys instanceof Map) || !config.publicKeys.size) fail("PAYMENT_VERIFIER_NOT_CONFIGURED");
  const normalized = new Map();
  for (const [key, value] of Object.entries(object(headers))) {
    const name = key.toLowerCase();
    if (!["wechatpay-timestamp", "wechatpay-nonce", "wechatpay-serial", "wechatpay-signature"].includes(name)) continue;
    if (normalized.has(name) || typeof value !== "string") fail("PAYMENT_SIGNATURE_INVALID");
    normalized.set(name, value);
  }
  const timestamp = normalized.get("wechatpay-timestamp"), nonce = normalized.get("wechatpay-nonce");
  const serial = normalized.get("wechatpay-serial"), signature = normalized.get("wechatpay-signature");
  if (!/^\d{10}$/.test(timestamp) || !/^[\x21-\x7e]{1,128}$/.test(nonce || "") || !/^PUB_KEY_ID_\d{1,100}$/.test(serial || "")) fail("PAYMENT_SIGNATURE_INVALID");
  if (!Number.isSafeInteger(now) || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) fail("PAYMENT_SIGNATURE_EXPIRED");
  const pem = config.publicKeys.get(serial);
  if (!pem) fail("PAYMENT_UNKNOWN_KEY");
  if (typeof pem !== "string" || !pem.startsWith("-----BEGIN PUBLIC KEY-----")) fail("PAYMENT_VERIFIER_NOT_CONFIGURED");
  let publicKey;
  try { publicKey = crypto.createPublicKey(pem); } catch { fail("PAYMENT_VERIFIER_NOT_CONFIGURED"); }
  if (publicKey.asymmetricKeyType !== "rsa" || publicKey.asymmetricKeyDetails.modulusLength !== 2048) fail("PAYMENT_VERIFIER_NOT_CONFIGURED");
  let signatureBytes;
  try { signatureBytes = base64(signature); } catch { fail("PAYMENT_SIGNATURE_INVALID"); }
  const message = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`, "utf8"), body, Buffer.from("\n")]);
  if (!crypto.verify("RSA-SHA256", message, { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, signatureBytes)) fail("PAYMENT_SIGNATURE_INVALID");
  return body;
}

function decryptNotification(rawBody, headers, config, now = Date.now()) {
  const envelope = parse(verifyMessage(rawBody, headers, config, now));
  if (envelope.event_type !== "TRANSACTION.SUCCESS" || envelope.resource_type !== "encrypt-resource") fail("PAYMENT_EVENT_UNSUPPORTED");
  token(envelope.id, 128);
  const resource = object(envelope.resource);
  if (resource.algorithm !== "AEAD_AES_256_GCM" || resource.original_type !== "transaction") fail("PAYMENT_MESSAGE_INVALID");
  const key = config.apiV3Key;
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("PAYMENT_VERIFIER_NOT_CONFIGURED");
  if (typeof resource.nonce !== "string" || Buffer.byteLength(resource.nonce, "utf8") !== 12
    || resource.associated_data !== undefined && (typeof resource.associated_data !== "string" || Buffer.byteLength(resource.associated_data, "utf8") > 16)) fail("PAYMENT_MESSAGE_INVALID");
  const ciphertext = base64(resource.ciphertext);
  if (ciphertext.length <= 16) fail("PAYMENT_MESSAGE_INVALID");
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(resource.nonce, "utf8"));
    decipher.setAAD(Buffer.from(resource.associated_data || "", "utf8"));
    decipher.setAuthTag(ciphertext.subarray(-16));
    plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  } catch { fail("PAYMENT_DECRYPTION_FAILED"); }
  return { notificationId: envelope.id, transaction: parse(plaintext) };
}

function normalizeCombineSuccess(transaction) {
  const data = object(transaction);
  if (!Array.isArray(data.sub_orders) || data.sub_orders.length !== 1) fail("PAYMENT_SUBORDERS_UNSUPPORTED");
  const sub = object(data.sub_orders[0]), amount = object(sub.amount);
  if (sub.trade_state !== "SUCCESS" || sub.trade_type !== "JSAPI") fail("PAYMENT_EVENT_UNSUPPORTED");
  if (sub.mchid !== data.combine_mchid) fail("PAYMENT_MESSAGE_INVALID");
  if (![amount.total_amount, amount.payer_amount].every(Number.isSafeInteger) || amount.total_amount <= 0 || amount.payer_amount < 0
    || amount.payer_amount > amount.total_amount || !/^[A-Z]{3}$/.test(amount.currency || "")) fail("PAYMENT_MESSAGE_INVALID");
  // This domestic flow does not infer exchange rates or silently discard a different payer currency.
  if (amount.payer_currency !== amount.currency) fail("PAYMENT_CURRENCY_UNSUPPORTED");
  if (typeof sub.success_time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(sub.success_time)) fail("PAYMENT_MESSAGE_INVALID");
  const paidAt = Date.parse(sub.success_time);
  if (!Number.isSafeInteger(paidAt) || paidAt <= 0) fail("PAYMENT_MESSAGE_INVALID");
  const zone = sub.success_time.slice(-6);
  const offset = sub.success_time.endsWith("Z") ? 0 : (zone[0] === "+" ? 1 : -1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4)));
  if (new Date(paidAt + offset * 60000).toISOString().slice(0, 19) !== sub.success_time.slice(0, 19)) fail("PAYMENT_MESSAGE_INVALID");
  return { tradeState: "SUCCESS", combineOutTradeNo: token(data.combine_out_trade_no, 32), outTradeNo: token(sub.out_trade_no, 32),
    appid: token(data.combine_appid, 32), platformMchid: token(data.combine_mchid, 32), subMchid: token(sub.sub_mchid, 32),
    payerOpenid: token(object(data.combine_payer_info).openid), transactionId: token(sub.transaction_id, 64),
    totalFen: amount.total_amount, payerPaidFen: amount.payer_amount, currency: amount.currency, paidAt };
}

module.exports = { verifyMessage, decryptNotification, normalizeCombineSuccess };
