// Test-only cryptographic fixtures. No real merchant key, payment or network call.
const crypto = require("node:crypto");

function createNotificationFixture() {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serial = "PUB_KEY_ID_3000000001";
  const config = { apiV3Key: crypto.randomBytes(32), publicKeys: new Map([[serial, pair.publicKey.export({ type: "spki", format: "pem" })]]) };
  function sign(body, now) {
    const timestamp = String(Math.floor(now / 1000)), nonce = crypto.randomBytes(16).toString("hex");
    const headers = { "Wechatpay-Timestamp": timestamp, "Wechatpay-Nonce": nonce, "Wechatpay-Serial": serial,
      "Wechatpay-Signature": crypto.sign("RSA-SHA256", Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), Buffer.from(body), Buffer.from("\n")]), pair.privateKey).toString("base64") };
    return { method: "POST", statusCode: 200, body: Buffer.from(body), headers };
  }
  function notify(transaction, now, patch = {}, originalType = 'transaction') {
    const nonce = crypto.randomBytes(6).toString("hex"), associated_data = "transaction";
    const cipher = crypto.createCipheriv("aes-256-gcm", config.apiV3Key, Buffer.from(nonce));
    cipher.setAAD(Buffer.from(associated_data));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(transaction)), cipher.final(), cipher.getAuthTag()]).toString("base64");
    const envelope = { id: `EV-${crypto.randomUUID()}`, create_time: new Date(now).toISOString(), event_type: "TRANSACTION.SUCCESS", resource_type: "encrypt-resource",
      resource: { original_type: originalType, algorithm: "AEAD_AES_256_GCM", nonce, associated_data, ciphertext }, ...patch };
    return sign(JSON.stringify(envelope), now);
  }
  function transaction(payment) {
    return { combine_appid: payment.appid, combine_mchid: payment.platformMchid, combine_out_trade_no: payment.combineOutTradeNo,
      combine_payer_info: { openid: payment.payerOpenid }, sub_orders: [{ mchid: payment.platformMchid, sub_mchid: payment.subMchid,
        trade_type: "JSAPI", trade_state: "SUCCESS", out_trade_no: payment.outTradeNo, transaction_id: payment.transactionId,
        success_time: new Date(payment.paidAt).toISOString(), amount: { total_amount: payment.totalFen, payer_amount: payment.payerPaidFen,
          currency: payment.currency, payer_currency: payment.currency } }] };
  }
  return { config, sign, notify, transaction };
}

module.exports = { createNotificationFixture };
