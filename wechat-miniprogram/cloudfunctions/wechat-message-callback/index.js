const {
  decryptWechatMessage,
  normalizeMediaCheck,
  parseRequestBody,
  verifyEncryptedSignature,
  verifyPlainSignature
} = require("./callback-core");

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

function rows(result, operation) {
  if (result && result.error) throw new Error(`${operation}: ${result.error.message || result.error}`);
  return result && Array.isArray(result.data) ? result.data : [];
}

async function persistMediaResult(db, result, now = Date.now()) {
  const check = rows(
    await db.from("media_security_checks")
      .select("asset_id,status")
      .eq("trace_id", result.traceId),
    "read media security check"
  )[0];
  if (!check) throw new Error("SECURITY_CHECK_NOT_READY");

  const asset = rows(
    await db.from("media_assets").select("id,status").eq("id", check.asset_id),
    "read media asset"
  )[0];
  if (!asset) throw new Error("MEDIA_ASSET_NOT_FOUND");

  if (asset.status === "PENDING") {
    rows(
      await db.from("media_assets")
        .update({ status: result.assetStatus })
        .eq("id", check.asset_id)
        .eq("status", "PENDING"),
      "update media asset status"
    );
  }

  rows(
    await db.from("media_security_checks")
      .update({
        status: result.status,
        label: result.label,
        detail_json: JSON.stringify(result.detail),
        resolved_at: now,
        updated_at: now
      })
      .eq("asset_id", check.asset_id)
      .eq("trace_id", result.traceId),
    "update media security check"
  );
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
    let message = envelope;
    if (envelope.Encrypt) {
      const aesKey = requiredEnv("WX_CALLBACK_AES_KEY", /^[A-Za-z0-9]{43}$/);
      const valid = verifyEncryptedSignature(
        token,
        query.timestamp,
        query.nonce,
        envelope.Encrypt,
        query.msg_signature
      );
      if (!valid) return response(403, "forbidden");
      message = JSON.parse(decryptWechatMessage(envelope.Encrypt, aesKey, appId));
    } else if (!verifyPlainSignature(token, query.timestamp, query.nonce, query.signature)) {
      return response(403, "forbidden");
    }

    const result = normalizeMediaCheck(message);
    if (!result) return response(200, "success");

    const cloudbase = require("@cloudbase/node-sdk");
    const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
    await persistMediaResult(app.rdb(), result);
    return response(200, "success");
  } catch (error) {
    console.error(JSON.stringify({
      scope: "wechat-message-callback",
      code: error && error.message ? error.message : "UNEXPECTED"
    }));
    return response(500, "retry");
  }
};

exports.persistMediaResult = persistMediaResult;
