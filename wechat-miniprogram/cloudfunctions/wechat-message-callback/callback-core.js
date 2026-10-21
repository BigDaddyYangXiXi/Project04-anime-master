const crypto = require("node:crypto");

function sha1Signature(values) {
  return crypto.createHash("sha1").update(values.map(String).sort().join("")).digest("hex");
}

function signaturesEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyPlainSignature(token, timestamp, nonce, signature) {
  return signaturesEqual(signature, sha1Signature([token, timestamp, nonce]));
}

function verifyEncryptedSignature(token, timestamp, nonce, encrypted, signature) {
  return signaturesEqual(signature, sha1Signature([token, timestamp, nonce, encrypted]));
}

function removePkcs7Padding(buffer) {
  if (!buffer.length) throw new Error("INVALID_PADDING");
  const padding = buffer[buffer.length - 1];
  if (padding < 1 || padding > 32 || padding > buffer.length) throw new Error("INVALID_PADDING");
  for (let index = buffer.length - padding; index < buffer.length; index += 1) {
    if (buffer[index] !== padding) throw new Error("INVALID_PADDING");
  }
  return buffer.subarray(0, buffer.length - padding);
}

function decryptWechatMessage(encrypted, encodingAesKey, expectedAppId) {
  if (!/^[A-Za-z0-9]{43}$/.test(encodingAesKey || "")) throw new Error("INVALID_AES_KEY");
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("INVALID_AES_KEY");

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]);
  const plain = removePkcs7Padding(padded);
  if (plain.length < 20) throw new Error("INVALID_ENCRYPTED_MESSAGE");

  const messageLength = plain.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageEnd > plain.length) throw new Error("INVALID_ENCRYPTED_MESSAGE");

  const message = plain.subarray(messageStart, messageEnd).toString("utf8");
  const appId = plain.subarray(messageEnd).toString("utf8");
  if (appId !== expectedAppId) throw new Error("APP_ID_MISMATCH");
  return message;
}

function parseRequestBody(event) {
  const raw = event && event.body ? event.body : "";
  const text = event && event.isBase64Encoded
    ? Buffer.from(raw, "base64").toString("utf8")
    : String(raw);
  return JSON.parse(text || "{}");
}

function normalizeMediaCheck(message) {
  if (!message || message.Event !== "wxa_media_check") return null;
  const traceId = String(message.trace_id || message.traceId || "").trim();
  if (!traceId) throw new Error("TRACE_ID_MISSING");

  const suggest = String(message.result && message.result.suggest || "").toLowerCase();
  const statusBySuggest = { pass: "PASS", review: "REVIEW", risky: "RISKY" };
  const successful = message.errcode === undefined || message.errcode === 0;
  const status = successful && Object.hasOwn(statusBySuggest, suggest) ? statusBySuggest[suggest] : "ERROR";
  const rawLabel = message.result && message.result.label;
  const label = Number.isFinite(Number(rawLabel)) ? Number(rawLabel) : null;
  return {
    traceId,
    status,
    assetStatus: status === "PASS" ? "READY" : "REJECTED",
    label,
    detail: Array.isArray(message.detail) ? message.detail : []
  };
}

module.exports = {
  decryptWechatMessage,
  normalizeMediaCheck,
  parseRequestBody,
  sha1Signature,
  verifyEncryptedSignature,
  verifyPlainSignature
};
