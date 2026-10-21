const VERSION = 'PLATFORM_20_PERCENT_V1';

function platformFee(totalFen) {
  if (!Number.isSafeInteger(totalFen) || totalFen <= 0) {
    const error = new Error('PAYMENT_AMOUNT_INVALID'); error.code = error.message; throw error;
  }
  // Round the platform's 1/5 share to the nearest cent without floating point multiplication.
  const amountFen = Number((BigInt(totalFen) + 2n) / 5n);
  return { version: VERSION, amountFen, providerAmountFen: totalFen - amountFen };
}

// Reverse the change in cumulative retained shares, never round each partial refund independently.
function refundAllocation({ totalFen, platformFeeFen, feeRuleVersion, previouslyRefundedFen, refundFen }) {
  const snapshot = platformFee(totalFen);
  if (feeRuleVersion !== VERSION || platformFeeFen !== snapshot.amountFen) {
    const error = new Error('REFUND_FEE_SNAPSHOT_MISMATCH'); error.code = error.message; throw error;
  }
  if (!Number.isSafeInteger(previouslyRefundedFen) || previouslyRefundedFen < 0 || previouslyRefundedFen > totalFen
    || !Number.isSafeInteger(refundFen) || refundFen <= 0 || refundFen > totalFen - previouslyRefundedFen) {
    const error = new Error('REFUND_AMOUNT_INVALID'); error.code = error.message; throw error;
  }
  const before = totalFen - previouslyRefundedFen, after = before - refundFen;
  const beforeFee = before === 0 ? 0 : platformFee(before).amountFen;
  const afterFee = after === 0 ? 0 : platformFee(after).amountFen;
  const platformReversalFen = beforeFee - afterFee;
  return { feeRuleVersion, cumulativeRefundFen: previouslyRefundedFen + refundFen,
    platformReversalFen, providerReversalFen: refundFen - platformReversalFen,
    retainedTotalFen: after, retainedPlatformFen: afterFee, retainedProviderFen: after - afterFee };
}

module.exports = { VERSION, platformFee, refundAllocation };
