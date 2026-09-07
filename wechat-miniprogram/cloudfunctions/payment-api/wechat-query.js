const crypto = require("node:crypto");
const https = require("node:https");
const { acceptPaymentQuery } = require("./payment-notifications");

function failure(code) { const error = new Error(code); error.code = code; return error; }
function paymentId(value) { if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) throw failure("PAYMENT_INPUT_INVALID"); }

function buildQueryRequest(id, config, now = Date.now()) {
  paymentId(id);
  if (!config || !/^[0-9]{1,32}$/.test(config.platformMchid || "")
    || !/^[A-Fa-f0-9]{1,64}$/.test(config.merchantSerial || "")
    || !/^PUB_KEY_ID_\d{1,100}$/.test(config.wechatPublicKeyId || "")
    || !(config.publicKeys instanceof Map) || !config.publicKeys.has(config.wechatPublicKeyId)
    || typeof config.merchantPrivateKey !== "string" || !Number.isSafeInteger(now) || now <= 0) throw failure("PAYMENT_QUERY_NOT_CONFIGURED");
  let key;
  try { key = crypto.createPrivateKey(config.merchantPrivateKey); } catch { throw failure("PAYMENT_QUERY_NOT_CONFIGURED"); }
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength !== 2048) throw failure("PAYMENT_QUERY_NOT_CONFIGURED");
  const path = `/v3/combine-transactions/out-trade-no/${id}`;
  const timestamp = String(Math.floor(now / 1000)), nonce = crypto.randomBytes(16).toString("hex");
  // GET has an empty body; the fifth line and its terminating newline must both be present.
  const message = `GET\n${path}\n${timestamp}\n${nonce}\n\n`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(message), { key, padding: crypto.constants.RSA_PKCS1_PADDING }).toString("base64");
  return { protocol: "https:", hostname: "api.mch.weixin.qq.com", port: 443, method: "GET", path,
    rejectUnauthorized: true, minVersion: "TLSv1.2", agent: false, maxHeaderSize: 16384,
    headers: { Accept: "application/json", "Accept-Encoding": "identity", "Wechatpay-Serial": config.wechatPublicKeyId,
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${config.platformMchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.merchantSerial}"` } };
}

// No redirects, caller-selected host, automatic retries or JSON reserialization.
function requestCombineOrder(options, request) {
  return new Promise((resolve, reject) => {
    let client, incoming, settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) { if (incoming) incoming.destroy(); if (client) client.destroy(); reject(error); }
      else resolve(response);
    };
    const deadline = setTimeout(() => finish(failure("PAYMENT_QUERY_TIMEOUT")), 8000);
    try {
      client = request(options, (response) => {
        incoming = response;
        response.on("error", () => finish(failure("PAYMENT_QUERY_TRANSPORT_FAILED")));
        response.on("aborted", () => finish(failure("PAYMENT_QUERY_TRANSPORT_FAILED")));
        response.on("close", () => { if (!settled) finish(failure("PAYMENT_QUERY_TRANSPORT_FAILED")); });
        if (settled) { response.destroy(); return; }
        if (response.statusCode !== 200) { finish(failure("PAYMENT_QUERY_FAILED")); return; }
        const headers = Object.create(null);
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          const name = response.rawHeaders[i].toLowerCase(), value = response.rawHeaders[i + 1];
          // Node's normalized headers can collapse duplicates; retain this check on the raw pairs.
          if (Object.hasOwn(headers, name)) { finish(failure("PAYMENT_QUERY_HEADERS_INVALID")); return; }
          headers[name] = value;
        }
        if (headers["content-encoding"] && headers["content-encoding"] !== "identity") { finish(failure("PAYMENT_QUERY_ENCODING_UNSUPPORTED")); return; }
        let size = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { finish(failure("PAYMENT_QUERY_TOO_LARGE")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => finish(null, { statusCode: 200, headers, body: Buffer.concat(chunks) }));
      });
      client.on("error", () => finish(failure("PAYMENT_QUERY_TRANSPORT_FAILED")));
      client.end();
    } catch { finish(failure("PAYMENT_QUERY_TRANSPORT_FAILED")); }
  });
}

// Internal recovery worker only. A public caller still needs server-resolved order ownership.
// A failed query never means an unpaid/closed order; only a verified channel state can reach persistence.
async function queryPayment(pool, id, config, request = https.request, clock = Date.now) {
  paymentId(id);
  const [[payment]] = await pool.execute("SELECT platform_mchid FROM order_payments WHERE id = ?", [id]);
  if (!payment) throw failure("PAYMENT_NOT_FOUND");
  if (!config || payment.platform_mchid !== config.platformMchid) throw failure("PAYMENT_QUERY_MERCHANT_MISMATCH");
  const response = await requestCombineOrder(buildQueryRequest(id, config, clock()), request);
  return acceptPaymentQuery(pool, response, config, id, clock());
}

module.exports = { buildQueryRequest, queryPayment };
