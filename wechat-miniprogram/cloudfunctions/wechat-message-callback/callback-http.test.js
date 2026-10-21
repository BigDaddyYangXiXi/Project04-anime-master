const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const core = require("./callback-core");
const appId = "wxc94e1c1b38944511";
const token = "localtesttoken";
const aesKey = "A".repeat(43);

function handler() {
  let sdkAccess = 0;
  const sandbox = { exports: {}, process: { env: { WX_APP_ID: appId, WX_CALLBACK_TOKEN: token, WX_CALLBACK_AES_KEY: aesKey } },
    console: { error() {} }, require(name) {
      if (name !== "./callback-core") { sdkAccess++; throw new Error("DATABASE_ACCESS_FORBIDDEN_IN_TEST"); }
      return core;
    } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, "utf8"), sandbox);
  return async event => {
    const result = await sandbox.exports.main(event);
    assert.equal(sdkAccess, 0, "Handshake and rejected requests must not access the database SDK");
    return result;
  };
}

function encryptedEvent(targetAppId = appId, message = { Event: "anime_master_callback_audit" }) {
  const key = Buffer.from(`${aesKey}=`, "base64");
  const body = Buffer.from(JSON.stringify(message));
  const length = Buffer.alloc(4); length.writeUInt32BE(body.length);
  const plain = Buffer.concat([crypto.randomBytes(16), length, body, Buffer.from(targetAppId)]);
  const padding = 32 - plain.length % 32;
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([plain, Buffer.alloc(padding, padding)])), cipher.final()]).toString("base64");
  return { httpMethod: "POST", body: JSON.stringify({ Encrypt: encrypted }), queryStringParameters: {
    timestamp: "1714112445", nonce: "testnonce",
    msg_signature: core.sha1Signature([token, "1714112445", "testnonce", encrypted])
  } };
}

test("company callback handshake accepts a valid signature and rejects forgery without database access", async () => {
  const main = handler();
  const query = { timestamp: "1714112445", nonce: "testnonce", echostr: "handshake" };
  query.signature = core.sha1Signature([token, query.timestamp, query.nonce]);
  const valid = await main({ httpMethod: "GET", queryStringParameters: query });
  assert.equal(valid.statusCode, 200); assert.equal(valid.body, "handshake");
  const invalid = await main({ httpMethod: "GET", queryStringParameters: { ...query, signature: "0".repeat(40) } });
  assert.equal(invalid.statusCode, 403);
});

test("company encrypted callback supports base64 gateway bodies and rejects a forged signature", async () => {
  const main = handler(); const event = encryptedEvent();
  const valid = await main({ ...event, body: Buffer.from(event.body).toString("base64"), isBase64Encoded: true });
  assert.equal(valid.statusCode, 200); assert.equal(valid.body, "success");
  const invalid = await main({ ...event, queryStringParameters: { ...event.queryStringParameters, msg_signature: "0".repeat(40) } });
  assert.equal(invalid.statusCode, 403);
});

test("even a correctly signed envelope for the old AppID cannot reach persistence", async () => {
  const result = await handler()(encryptedEvent("wx57412ad07a806b70", { Event: "wxa_media_check", trace_id: "forged", result: { suggest: "pass" } }));
  assert.equal(result.statusCode, 500); assert.equal(result.body, "retry");
});

test("unsigned media verdict and unsupported methods never access persistence", async () => {
  const main = handler();
  const result = await main({ httpMethod: "POST", body: JSON.stringify({ Event: "wxa_media_check", trace_id: "forged", result: { suggest: "pass" } }) });
  assert.equal(result.statusCode, 403);
  assert.equal((await main({ httpMethod: "PUT" })).statusCode, 405);
});

test('subscription observations require the encrypted company envelope and successful persistence', async () => {
  const { TEMPLATE_ID } = require('../../miniprogram/services/order-subscription');
  const stored = new Map(); const logs = []; let writes = 0, databaseFailed = false;
  const sandbox = { exports: {}, process: { env: { WX_APP_ID: appId, WX_CALLBACK_TOKEN: token, WX_CALLBACK_AES_KEY: aesKey } },
    console: { error(value) { logs.push(value); } }, require(name) {
      if (name === './callback-core') return core;
      if (name === './subscription-events') return require('./subscription-events');
      assert.equal(name, '@cloudbase/node-sdk');
      return { init() { return { rdb() { return { from(table) {
        assert.equal(table, 'wechat_subscription_events');
        return { async upsert(rows, options) {
          writes++; assert.equal(options.ignoreDuplicates, true);
          if (databaseFailed) return { error: { message: 'private-database-sentinel' } };
          for (const row of rows) if (!stored.has(row.event_key)) stored.set(row.event_key, row);
          return { data: [] };
        } };
      } }; } }; } };
    } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  const message = { MsgType: 'event', Event: 'subscribe_msg_popup_event', FromUserName: 'private_user_sentinel',
    CreateTime: '1620973045', List: { TemplateId: TEMPLATE_ID, SubscribeStatusString: 'accept' } };
  const main = sandbox.exports.main;
  const forged = encryptedEvent(appId, message);
  forged.queryStringParameters.msg_signature = '0'.repeat(40);
  assert.equal((await main(forged)).statusCode, 403);
  assert.equal((await main(encryptedEvent('wx57412ad07a806b70', message))).statusCode, 500);
  assert.equal(writes, 0);
  for (let index = 0; index < 2; index++) {
    const reply = await main(encryptedEvent(appId, message));
    assert.equal(reply.statusCode, 200); assert.equal(reply.body, 'success');
  }
  assert.equal(stored.size, 1);
  databaseFailed = true;
  const failed = await main(encryptedEvent(appId, message));
  assert.equal(failed.statusCode, 500); assert.equal(failed.body, 'retry');
  assert.doesNotMatch(JSON.stringify({ logs, stored: [...stored.values()] }), /private_user_sentinel|private-database-sentinel/);
});
