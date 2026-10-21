// Internal projection of a complete, server-verified payment snapshot for ONE request.
// Does not verify receipts, approve tax, release reservations, or authorize a bank payment.
function positiveFen(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw Error('WITHDRAWAL_AMOUNT_INVALID');
  return BigInt(value);
}
function withdrawalProgress(approvedNetFen, parts) {
  const total = positiveFen(approvedNetFen);
  if (!Array.isArray(parts)) throw Error('WITHDRAWAL_PARTS_INVALID');
  let paid = 0n, inFlight = 0n, needsReview = false;
  const seen = new Set();
  for (const part of parts) {
    if (!part || typeof part.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(part.id)
      || !['SUCCEEDED', 'RESERVED', 'EXPORTED', 'PROCESSING', 'UNKNOWN', 'FAILED', 'CANCELLED'].includes(part.status)) {
      throw Error('WITHDRAWAL_PART_INVALID');
    }
    if (seen.has(part.id)) throw Error('WITHDRAWAL_PART_DUPLICATE');
    seen.add(part.id);
    const amount = positiveFen(part.amountFen);
    if (amount > total) throw Error('WITHDRAWAL_PART_OVERALLOCATED');
    if (part.status === 'SUCCEEDED') paid += amount;
    // Includes internal reservations; PROCESSING does not assert bank acceptance.
    else if (['RESERVED', 'EXPORTED', 'PROCESSING', 'UNKNOWN'].includes(part.status)) inFlight += amount;
    if (part.status === 'UNKNOWN') needsReview = true;
  }
  if (paid + inFlight > total) throw Error('WITHDRAWAL_PART_OVERALLOCATED');
  return {
    approvedNetFen: String(total), paidFen: String(paid), inFlightFen: String(inFlight),
    remainingFen: String(total - paid), unallocatedFen: String(total - paid - inFlight),
    status: paid === total ? 'PAID' : paid > 0n ? 'PARTIALLY_PAID' : inFlight > 0n ? 'PROCESSING' : 'UNPAID',
    needsReview
  };
}
module.exports = { withdrawalProgress };
