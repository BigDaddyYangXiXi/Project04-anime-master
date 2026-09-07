const { decryptNotification, normalizeCombineSuccess, normalizeCombineQuery, verifyMessage } = require("./wechat-verification");
const { recordPaymentSuccess, recordPaymentClosed, readPendingPayment } = require("./payment-store");

// Internal handlers: public HTTP routing and authenticated query transport are configured separately.
// The gateway must preserve the original body bytes. No JSON object may stand in for the signed body.
async function acceptPaymentNotification(pool, request, config, now = Date.now()) {
  if (request.method !== "POST") return { statusCode: 405, body: "" };
  const notification = decryptNotification(request.body, request.headers, config, now);
  const payment = normalizeCombineSuccess(notification.transaction);
  await recordPaymentSuccess(pool, payment, now);
  // Acknowledge only after the transaction commits, including a durably saved review case.
  return { statusCode: 204, body: "" };
}

async function acceptPaymentQuery(pool, response, config, expectedPaymentId, now = Date.now()) {
  if (response.statusCode !== 200) { const error = new Error("PAYMENT_QUERY_FAILED"); error.code = error.message; throw error; }
  const raw = verifyMessage(response.body, response.headers, config, now);
  let transaction;
  try { transaction = JSON.parse(raw.toString("utf8")); } catch { const error = new Error("PAYMENT_MESSAGE_INVALID"); error.code = error.message; throw error; }
  const payment = normalizeCombineQuery(transaction);
  if (payment.combineOutTradeNo !== expectedPaymentId || payment.outTradeNo !== expectedPaymentId) {
    const error = new Error("PAYMENT_QUERY_MISMATCH"); error.code = error.message; throw error;
  }
  if (payment.tradeState === "SUCCESS") return recordPaymentSuccess(pool, payment, now);
  if (payment.tradeState === "CLOSED") return recordPaymentClosed(pool, payment, now);
  return readPendingPayment(pool, payment);
}

module.exports = { acceptPaymentNotification, acceptPaymentQuery };
