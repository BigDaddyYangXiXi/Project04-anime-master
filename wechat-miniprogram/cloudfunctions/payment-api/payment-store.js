const crypto = require("node:crypto");

function fail(code) { const error = new Error(code); error.code = code; throw error; }
function token(value, max = 128) {
  if (typeof value !== "string" || !value.length || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) fail("PAYMENT_INPUT_INVALID");
  return value;
}
function cents(value, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) fail("PAYMENT_AMOUNT_INVALID");
  return value;
}
function payloadOf(order) { return typeof order.payload === "string" ? JSON.parse(order.payload) : order.payload; }
function agreementHash(order) {
  const p = payloadOf(order).public;
  const snapshot = [order.buyer_id, order.provider_id, p.amountFen, p.items, p.timeSegments, p.cityCode, p.location,
    p.requirement, p.communicationDone, p.timePlaceConfirmed, p.serviceScopeConfirmed, p.amountConfirmed,
    p.executable, p.ndaRequired, p.buyerNdaSigned, p.providerNdaSigned, p.buyerAgreementConfirmedAt];
  return crypto.createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
function agreementReady(order) {
  const p = payloadOf(order).public;
  return order.stage === "BUYER_FINAL_CONFIRM" && p.buyerAgreementConfirmedAt > 0
    && [p.communicationDone, p.timePlaceConfirmed, p.serviceScopeConfirmed, p.amountConfirmed, p.executable].every((value) => value === true)
    && typeof p.ndaRequired === "boolean" && (!p.ndaRequired || p.buyerNdaSigned === true && p.providerNdaSigned === true);
}

async function inTransaction(pool, work) {
  const connection = await pool.getConnection();
  let reusable = true;
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { reusable = false; }
    throw error;
  } finally {
    if (reusable) connection.release();
    else connection.destroy();
  }
}

async function lockedOrder(connection, orderId) {
  const [orders] = await connection.execute("SELECT * FROM order_aggregates WHERE id = ? FOR UPDATE", [orderId]);
  if (!orders.length) fail("ORDER_NOT_FOUND");
  return orders[0];
}

// Internal persistence API. Callers must resolve identity and fee policy on the server.
// No public cloud-function entry is registered until channel verification and slot reservation are implemented.
async function reservePayment(pool, input, now = Date.now(), randomId = () => crypto.randomBytes(16).toString("hex")) {
  const orderId = token(input.orderId, 64), buyerId = token(input.buyerId, 64), requestKey = token(input.requestKey);
  const appid = token(input.appid, 32), platformMchid = token(input.platformMchid, 32), openid = token(input.payerOpenid);
  if (requestKey.length < 16 || !Number.isSafeInteger(input.expectedVersion)) fail("PAYMENT_INPUT_INVALID");
  return inTransaction(pool, async (connection) => {
    const order = await lockedOrder(connection, orderId);
    if (order.buyer_id !== buyerId) fail("ORDER_NOT_FOUND");
    const [existing] = await connection.execute("SELECT * FROM order_payments WHERE order_id = ? ORDER BY created_at, id FOR UPDATE", [orderId]);
    const same = existing.find((payment) => payment.request_key === requestKey);
    if (same) {
      if (same.appid !== appid || same.platform_mchid !== platformMchid || same.payer_openid !== openid) fail("PAYMENT_IDEMPOTENCY_CONFLICT");
      return same;
    }
    if (existing.some((payment) => payment.status !== "CLOSED")) fail("PAYMENT_ALREADY_EXISTS");
    if (Number(order.version) !== input.expectedVersion) fail("VERSION_CONFLICT");
    if (!agreementReady(order)) fail("AGREEMENT_NOT_CONFIRMED");
    const p = payloadOf(order).public;
    if (!["UNPAID", "FAILED"].includes(p.paymentStatus)) fail("PAYMENT_ALREADY_EXISTS");
    const amountFen = cents(Number(p.amountFen));
    if (!input.fee || !input.fee.version || !Number.isSafeInteger(input.fee.amountFen)
      || input.fee.amountFen <= 0 || input.fee.amountFen > amountFen) fail("PAYMENT_FEE_NOT_CONFIGURED");
    const feeVersion = token(input.fee.version, 64);
    const [merchants] = await connection.execute("SELECT * FROM provider_payment_merchants WHERE provider_id = ? FOR UPDATE", [order.provider_id]);
    const merchant = merchants[0];
    if (!merchant || merchant.status !== "READY" || Number(merchant.verified_at) <= 0 || merchant.platform_mchid !== platformMchid) fail("PAYMENT_MERCHANT_NOT_READY");
    const id = randomId();
    if (!/^[a-f0-9]{32}$/.test(id)) fail("PAYMENT_INPUT_INVALID");
    await connection.execute(`INSERT INTO order_payments
      (id, order_id, request_key, order_version, agreement_hash, appid, platform_mchid, sub_mchid, payer_openid,
       amount_fen, currency, fee_rule_version, platform_fee_fen, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?, 'CREATED', ?, ?)`,
    [id, orderId, requestKey, Number(order.version), agreementHash(order), appid, platformMchid, merchant.sub_mchid,
      openid, amountFen, feeVersion, input.fee.amountFen, now, now]);
    const [[payment]] = await connection.execute("SELECT * FROM order_payments WHERE id = ?", [id]);
    return payment;
  });
}

function validateBinding(payment, result) {
  if (result.combineOutTradeNo !== payment.id || result.outTradeNo !== payment.id || result.appid !== payment.appid
    || result.platformMchid !== payment.platform_mchid || result.subMchid !== payment.sub_mchid
    || result.payerOpenid !== payment.payer_openid) fail("PAYMENT_RESULT_MISMATCH");
}

async function withPayment(pool, result, work) {
  const paymentId = token(result.outTradeNo, 32);
  return inTransaction(pool, async (connection) => {
    const [[lookup]] = await connection.execute("SELECT order_id FROM order_payments WHERE id = ?", [paymentId]);
    if (!lookup) fail("PAYMENT_NOT_FOUND");
    // All writers lock the business order first, then its payment rows.
    const order = await lockedOrder(connection, lookup.order_id);
    const [[payment]] = await connection.execute("SELECT * FROM order_payments WHERE id = ? FOR UPDATE", [paymentId]);
    validateBinding(payment, result);
    return work(connection, order, payment);
  });
}

// Only invoke with a normalized, cryptographically verified SUCCESS from WeChat, never a client event.
async function recordPaymentSuccess(pool, result, now = Date.now()) {
  if (result.tradeState !== "SUCCESS") fail("PAYMENT_RESULT_INVALID");
  const transactionId = token(result.transactionId, 64);
  const total = cents(result.totalFen), paid = cents(result.payerPaidFen, 0), paidAt = cents(result.paidAt);
  if (paid > total || !/^[A-Z]{3}$/.test(result.currency)) fail("PAYMENT_RESULT_INVALID");
  return withPayment(pool, result, async (connection, order, payment) => {
    if (payment.transaction_id) {
      if (payment.transaction_id !== transactionId || Number(payment.received_total_fen) !== total
        || Number(payment.payer_paid_fen) !== paid || payment.received_currency !== result.currency || Number(payment.paid_at) !== paidAt) fail("PAYMENT_RESULT_CONFLICT");
      return { status: payment.status, duplicate: true };
    }
    const payload = payloadOf(order);
    const p = payload.public;
    const [otherReceipts] = await connection.execute("SELECT id FROM order_payments WHERE order_id = ? AND id <> ? AND transaction_id IS NOT NULL FOR UPDATE", [order.id, payment.id]);
    const reason = total !== Number(payment.amount_fen) || result.currency !== payment.currency ? "AMOUNT_OR_CURRENCY_MISMATCH"
      : payment.status === "CLOSED" ? "SUCCESS_AFTER_CLOSE"
        : otherReceipts.length ? "OTHER_PAYMENT_RECEIVED"
          : p.paymentStatus === "PAID" ? "ORDER_ALREADY_PAID"
          : !agreementReady(order) || agreementHash(order) !== payment.agreement_hash ? "AGREEMENT_OR_STAGE_CHANGED" : null;
    const status = reason ? "PAID_REQUIRES_REVIEW" : "PAID";
    await connection.execute(`UPDATE order_payments SET status = ?, transaction_id = ?, received_total_fen = ?,
      payer_paid_fen = ?, received_currency = ?, paid_at = ?, review_reason = ?, updated_at = ? WHERE id = ?`,
    [status, transactionId, total, paid, result.currency, paidAt, reason, now, payment.id]);
    if (!reason) {
      p.paymentStatus = "PAID";
      p.paymentTransactionId = transactionId;
      p.paidAt = paidAt;
      p.paymentId = payment.id;
      payload.events.push({ id: `pay_${payment.id}`, event: "PAYMENT_VERIFIED", fromStage: order.stage, toStage: order.stage, createdAt: now });
    } else {
      p.paymentStatus = "PAYMENT_REVIEW";
      payload.events.push({ id: `review_${payment.id}`, event: "PAYMENT_REVIEW_REQUIRED", fromStage: order.stage, toStage: order.stage, createdAt: now });
    }
    await connection.execute("UPDATE order_aggregates SET payload = ?, version = version + 1, updated_at = ? WHERE id = ?",
      [JSON.stringify(payload), now, order.id]);
    return { status, duplicate: false };
  });
}

async function recordPaymentClosed(pool, result, now = Date.now()) {
  if (result.tradeState !== "CLOSED") fail("PAYMENT_RESULT_INVALID");
  return withPayment(pool, result, async (connection, order, payment) => {
    if (payment.status !== "CREATED") return { status: payment.status };
    await connection.execute("UPDATE order_payments SET status = 'CLOSED', updated_at = ? WHERE id = ?", [now, payment.id]);
    return { status: "CLOSED" };
  });
}

module.exports = { inTransaction, reservePayment, recordPaymentSuccess, recordPaymentClosed };
