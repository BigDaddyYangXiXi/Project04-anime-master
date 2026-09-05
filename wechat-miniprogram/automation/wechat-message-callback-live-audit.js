const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const callbackUrl = "https://quest-band-d1gem4bxt3fa17720.service.tcloudbase.com/wechat-message-callback";

function encryptMessage(message, aesKeyText, appId) {
  const key = Buffer.from(`${aesKeyText}=`, "base64");
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const plain = Buffer.concat([crypto.randomBytes(16), length, body, Buffer.from(appId, "utf8")]);
  const padding = 32 - (plain.length % 32 || 32);
  const padded = Buffer.concat([plain, Buffer.alloc(padding || 32, padding || 32)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

function signature(values) {
  return crypto.createHash("sha1").update(values.map(String).sort().join("")).digest("hex");
}

async function run() {
  const token = process.env.WX_CALLBACK_TOKEN || "";
  const aesKey = process.env.WX_CALLBACK_AES_KEY || "";
  const appId = process.env.WX_APP_ID || "";
  assert.match(token, /^[A-Za-z0-9]{3,32}$/);
  assert.match(aesKey, /^[A-Za-z0-9]{43}$/);
  assert.match(appId, /^wx[A-Za-z0-9]{16}$/);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString("hex");
  const encrypted = encryptMessage({ Event: "anime_master_callback_audit" }, aesKey, appId);
  const msgSignature = signature([token, timestamp, nonce, encrypted]);
  const url = new URL(callbackUrl);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("msg_signature", msgSignature);

  const valid = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Encrypt: encrypted })
  });
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), "success");

  url.searchParams.set("msg_signature", "0".repeat(40));
  const invalid = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Encrypt: encrypted })
  });
  assert.equal(invalid.status, 403);
  assert.equal(await invalid.text(), "forbidden");
  console.log("CloudBase secure callback POST audit passed: valid=200, invalid=403");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
