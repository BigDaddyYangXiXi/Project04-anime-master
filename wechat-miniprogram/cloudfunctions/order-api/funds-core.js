function fail(code) { const error = new Error(code); error.code = code; throw error; }
function rows(result) { if (!result || result.error || !Array.isArray(result.data)) fail("DATABASE_OPERATION_FAILED"); return result.data; }
function integer(value, minimum = 0) {
  const number = Number(value);
  if (value === null || value === "" || typeof value === "boolean" || !Number.isSafeInteger(number) || number < minimum) fail("DATABASE_OPERATION_FAILED");
  return number;
}
const RECEIPT_STATUSES = ["PAID", "PAID_REQUIRES_REVIEW"];
const FIELDS = "id,order_id,status,transaction_id,amount_fen,platform_fee_fen,fee_rule_version,received_total_fen,payer_paid_fen,received_currency,paid_at,refunded_fen,platform_refunded_fen,provider_refunded_fen,order_aggregates!inner(provider_id)";

async function readProviderFunds(db, actor, event) {
  if (!actor.roles.includes("PROVIDER")) fail("PROVIDER_ROLE_REQUIRED");
  const cursor = event.cursor;
  if (cursor != null && (typeof cursor !== "object" || !Number.isSafeInteger(cursor.paidAt) || cursor.paidAt <= 0 || !/^[a-f0-9]{32}$/.test(cursor.id))) fail("VALIDATION_ERROR");
  const query = () => db.from("order_payments").select(FIELDS)
    .eq("order_aggregates.provider_id", actor.accountId).in("status", RECEIPT_STATUSES)
    .order("paid_at", { ascending: false }).order("id", { ascending: false });
  let records;
  if (cursor) {
    records = rows(await query().eq("paid_at", cursor.paidAt).lt("id", cursor.id).limit(21));
    if (records.length < 21) records.push(...rows(await query().lt("paid_at", cursor.paidAt).limit(21 - records.length)));
  } else records = rows(await query().limit(21));
  const merchants = rows(await db.from("provider_payment_merchants").select("status,verified_at").eq("provider_id", actor.accountId));
  const merchant = merchants[0];
  const merchantStatus = !merchant ? "NOT_STARTED" : merchant.status === "READY" && integer(merchant.verified_at) > 0 ? "READY"
    : merchant.status === "SUSPENDED" ? "SUSPENDED" : "PENDING";
  const hasMore = records.length > 20;
  const page = records.slice(0, 20).map((row) => {
    // Validate the joined owner again before serializing; never trust client-supplied provider IDs.
    if (!row.order_aggregates || row.order_aggregates.provider_id !== actor.accountId || !RECEIPT_STATUSES.includes(row.status)
      || !row.transaction_id || !/^[a-f0-9]{32}$/.test(row.id) || !/^[A-Z]{3}$/.test(row.received_currency)) fail("DATABASE_OPERATION_FAILED");
    const amountFen = integer(row.amount_fen, 1), totalFen = integer(row.received_total_fen, 1), payerPaidFen = integer(row.payer_paid_fen);
    const platformFeeFen = integer(row.platform_fee_fen);
    if (platformFeeFen > amountFen || !row.fee_rule_version) fail('DATABASE_OPERATION_FAILED');
    if (payerPaidFen > totalFen || row.status === "PAID" && (totalFen !== amountFen || row.received_currency !== "CNY")) fail("DATABASE_OPERATION_FAILED");
    const refundedFen = integer(row.refunded_fen), platformRefundedFen = integer(row.platform_refunded_fen), providerRefundedFen = integer(row.provider_refunded_fen);
    if (refundedFen > amountFen || platformRefundedFen > platformFeeFen || providerRefundedFen > amountFen - platformFeeFen
      || BigInt(platformRefundedFen) + BigInt(providerRefundedFen) !== BigInt(refundedFen)) fail('DATABASE_OPERATION_FAILED');
    // Validate the persisted V1 snapshot and cumulative reversal before displaying net income.
    // This read boundary never recalculates or overwrites historical monetary records.
    if (row.fee_rule_version !== 'PLATFORM_20_PERCENT_V1'
      || platformFeeFen !== Number((BigInt(amountFen) + 2n) / 5n)
      || platformFeeFen - platformRefundedFen !== Number((BigInt(amountFen - refundedFen) + 2n) / 5n)) fail('DATABASE_OPERATION_FAILED');
    return { id: row.id, orderId: row.order_id, status: row.status, amountFen,
      platformFeeFen, refundedFen, platformRefundedFen, providerRefundedFen,
      retainedAmountFen: amountFen - refundedFen, retainedPlatformFeeFen: platformFeeFen - platformRefundedFen,
      expectedIncomeFen: row.status === 'PAID' ? amountFen - platformFeeFen - providerRefundedFen : null,
      totalFen, payerPaidFen, currency: row.received_currency, paidAt: integer(row.paid_at, 1) };
  });
  const last = page[page.length - 1];
  return { records: page, nextCursor: hasMore ? { paidAt: last.paidAt, id: last.id } : null, merchantStatus,
    settlementStatus: "UNAVAILABLE", withdrawableBalanceFen: null };
}

module.exports = { readProviderFunds };
