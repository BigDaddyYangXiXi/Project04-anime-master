const assert = require("node:assert/strict");
const crypto = require("node:crypto");

function validateTarget(callbackUrl, appId) {
  const envId = require("../cloudbaserc.json").envId;
  assert.equal(envId, "cloudbase-d2g65rqbvee0bd978");
  assert.equal(appId, require("../project.config.json").appid);
  assert.equal(appId, "wxc94e1c1b38944511");
  const url = new URL(callbackUrl);
  assert.equal(url.protocol, "https:");
  // Verified by DescribeCloudBaseGWService for the deployed callback route.
  assert.equal(url.hostname, "cloudbase-d2g65rqbvee0bd978.service.tcloudbase.com");
  assert.equal(url.port, "");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.equal(url.pathname, "/wechat-message-callback");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  return url;
}

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
  // Require an explicitly confirmed deployed URL, never fall back to the old app.
  const url = validateTarget(process.env.WX_CALLBACK_URL || "", appId);

  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString("hex");
  const handshake = new URL(url);
  handshake.searchParams.set("timestamp", timestamp);
  handshake.searchParams.set("nonce", nonce);
  handshake.searchParams.set("echostr", "company-callback-handshake");
  handshake.searchParams.set("signature", signature([token, timestamp, nonce]));
  const accepted = await fetch(handshake, { redirect: "error", signal: AbortSignal.timeout(15000) });
  assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), "company-callback-handshake");
  const plaintext = await fetch(handshake, {
    redirect: "error", signal: AbortSignal.timeout(15000), method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Event: "anime_master_callback_audit" })
  });
  assert.equal(plaintext.status, 403);
  assert.equal(await plaintext.text(), "forbidden");
  handshake.searchParams.set("signature", "0".repeat(40));
  const rejected = await fetch(handshake, { redirect: "error", signal: AbortSignal.timeout(15000) });
  assert.equal(rejected.status, 403);
  assert.equal(await rejected.text(), "forbidden");
  const encrypted = encryptMessage({ Event: "anime_master_callback_audit" }, aesKey, appId);
  const msgSignature = signature([token, timestamp, nonce, encrypted]);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("msg_signature", msgSignature);

  const valid = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Encrypt: encrypted })
  });
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), "success");

  url.searchParams.set("msg_signature", "0".repeat(40));
  const invalid = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ Encrypt: encrypted })
  });
  assert.equal(invalid.status, 403);
  assert.equal(await invalid.text(), "forbidden");
  // Exercise the deployed subscription branch without inventing consent or writing a test user.
  for (const [message, expectedStatus, expectedBody] of [
    [{ MsgType: 'event', Event: 'subscribe_msg_popup_event', FromUserName: 'audit_no_write', CreateTime: 'invalid', List: {} }, 500, 'retry'],
    [{ MsgType: 'event', Event: 'subscribe_msg_popup_event', FromUserName: 'audit_no_write', CreateTime: timestamp,
      List: { TemplateId: 'audit_unconfigured_template', SubscribeStatusString: 'accept' } }, 200, 'success']
  ]) {
    const payload = encryptMessage(message, aesKey, appId);
    url.searchParams.set('msg_signature', signature([token, timestamp, nonce, payload]));
    const reply = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000), method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Encrypt: payload }) });
    assert.equal(reply.status, expectedStatus); assert.equal(await reply.text(), expectedBody);
  }
  console.log(JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), checks: 7,
    businessWritesRequested: false, scope: 'Public handshake/signature boundaries and non-writing subscription branches; not real consent or delivery.' }));
}

if (require.main === module) run().catch(() => {
  console.error("Company callback audit failed; verify target, configuration and HTTP responses. Raw signed request details are suppressed.");
  process.exitCode = 1;
});
module.exports = { validateTarget };
