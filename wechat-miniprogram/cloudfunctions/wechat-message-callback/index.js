const {
  decryptWechatMessage,
  normalizeMediaCheck,
  parseRequestBody,
  verifyEncryptedSignature,
  verifyPlainSignature
} = require("./callback-core");

const LOG_CODES = new Set([
  "WX_CALLBACK_TOKEN_INVALID", "WX_APP_ID_INVALID", "WX_CALLBACK_AES_KEY_INVALID",
  "DATABASE_OPERATION_FAILED", "SECURITY_CHECK_NOT_READY", "MEDIA_ASSET_NOT_FOUND",
  "SECURITY_RESULT_CONFLICT", "SECURITY_CHECK_STATE_CONFLICT",
  "INVALID_PADDING", "INVALID_AES_KEY", "INVALID_ENCRYPTED_MESSAGE", "APP_ID_MISMATCH", "TRACE_ID_MISSING",
  "SUBSCRIPTION_EVENT_INVALID"
]);

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: String(body)
  };
}

function requiredEnv(name, pattern) {
  const value = process.env[name] || "";
  if (!pattern.test(value)) throw new Error(`${name}_INVALID`);
  return value;
}

function rows(result) {
  if (result && result.error) throw new Error("DATABASE_OPERATION_FAILED");
  return result && Array.isArray(result.data) ? result.data : [];
}

async function persistMediaResult(db, result, now = Date.now()) {
  const check = rows(
    await db.from("media_security_checks")
      .select("asset_id,status")
      .eq("trace_id", result.traceId)
  )[0];
  if (!check) throw new Error("SECURITY_CHECK_NOT_READY");

  const asset = rows(
    await db.from("media_assets").select("id,status").eq("id", check.asset_id)
  )[0];
  if (!asset) throw new Error("MEDIA_ASSET_NOT_FOUND");

  if (["PASS", "REVIEW", "RISKY", "ERROR"].includes(check.status)) {
    if (check.status !== result.status) throw new Error("SECURITY_RESULT_CONFLICT");
  } else {
    if (!["PENDING", "SUBMITTING"].includes(check.status)) throw new Error("SECURITY_CHECK_STATE_CONFLICT");
    const persisted = rows(await db.from("media_security_checks")
      .update({ status: result.status, label: result.label, detail_json: JSON.stringify(result.detail), resolved_at: now, updated_at: now })
      .eq("asset_id", check.asset_id).eq("trace_id", result.traceId).eq("status", check.status).select("asset_id"));
    if (!persisted.length) throw new Error("SECURITY_CHECK_STATE_CONFLICT");
  }

  // Persist the verdict first. A repeated callback can finish this write after
  // interruption without replacing the original evidence or reviving a deletion.
  if (asset.status === "PENDING") {
    rows(await db.from("media_assets").update({ status: result.assetStatus })
      .eq("id", check.asset_id).eq("status", "PENDING"));
  }
}

exports.main = async (event, context) => {
  try {
    const token = requiredEnv("WX_CALLBACK_TOKEN", /^[A-Za-z0-9]{3,32}$/);
    const appId = requiredEnv("WX_APP_ID", /^wx[A-Za-z0-9]{16}$/);
    const query = event.queryStringParameters || {};
    const method = String(event.httpMethod || event.method || "").toUpperCase();

    if (method === "GET") {
      const valid = verifyPlainSignature(token, query.timestamp, query.nonce, query.signature);
      return valid && typeof query.echostr === "string"
        ? response(200, query.echostr)
        : response(403, "forbidden");
    }

    if (method !== "POST") return response(405, "method not allowed");

    const envelope = parseRequestBody(event);
    // POST requires safe mode: the encrypted signature covers the message body.
    if (!envelope || typeof envelope.Encrypt !== "string" || !envelope.Encrypt) return response(403, "forbidden");
    const aesKey = requiredEnv("WX_CALLBACK_AES_KEY", /^[A-Za-z0-9]{43}$/);
    const valid = verifyEncryptedSignature(
      token,
      query.timestamp,
      query.nonce,
      envelope.Encrypt,
      query.msg_signature
    );
    if (!valid) return response(403, "forbidden");
    const message = JSON.parse(decryptWechatMessage(envelope.Encrypt, aesKey, appId));

    if (['subscribe_msg_popup_event', 'subscribe_msg_change_event'].includes(message && message.Event)) {
      const { normalizeSubscriptionEvents, persistSubscriptionEvents } = require('./subscription-events');
      const observations = normalizeSubscriptionEvents(message);
      if (observations.length) {
        const cloudbase = require('@cloudbase/node-sdk');
        const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
        await persistSubscriptionEvents(app.rdb(), observations);
      }
      return response(200, 'success');
    }

    const result = normalizeMediaCheck(message);
    if (!result) return response(200, "success");

    const cloudbase = require("@cloudbase/node-sdk");
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    await persistMediaResult(app.rdb(), result);
    await require("./content-intents").wake(app);
    return response(200, "success");
  } catch (error) {
    console.error(JSON.stringify({
      scope: "wechat-message-callback",
      code: LOG_CODES.has(error && error.message) ? error.message : "UNEXPECTED"
    }));
    return response(500, "retry");
  }
};

exports.persistMediaResult = persistMediaResult;
