const test = require('node:test');
const assert = require('node:assert/strict');
const { VERSION, platformFee, refundAllocation } = require('./fee-policy');

test('confirmed 20 percent fee is fixed and preserves every cent', () => {
  for (const [total, platform, provider] of [[10000,2000,8000], [10001,2000,8001], [10003,2001,8002], [1,0,1], [2,0,2], [3,1,2]]) {
    assert.deepEqual(platformFee(total), { version: VERSION, amountFen: platform, providerAmountFen: provider });
  }
});

test('integer arithmetic remains exact at the supported money boundary', () => {
  const total = Number.MAX_SAFE_INTEGER, fee = platformFee(total);
  assert.equal(BigInt(fee.amountFen), (BigInt(total) + 2n) / 5n);
  assert.equal(fee.amountFen + fee.providerAmountFen, total);
});

test('invalid money is rejected instead of silently coercing caller data', () => {
  for (const total of [0,-1,1.5,'10000',NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(() => platformFee(total), { code: 'PAYMENT_AMOUNT_INVALID' });
  }
});

const refund = (totalFen, previouslyRefundedFen, refundFen) => refundAllocation({ totalFen,
  platformFeeFen: platformFee(totalFen).amountFen, feeRuleVersion: VERSION, previouslyRefundedFen, refundFen });
test('100 yuan refunded by 30 yuan reverses 6 platform and 24 provider yuan', () => {
  assert.deepEqual(refund(10000, 0, 3000), { feeRuleVersion: VERSION, cumulativeRefundFen: 3000,
    platformReversalFen: 600, providerReversalFen: 2400, retainedTotalFen: 7000,
    retainedPlatformFen: 1400, retainedProviderFen: 5600 });
});
test('cent-by-cent refunds reconcile exactly to the original fee at every step', () => {
  for (let total = 1; total <= 200; total++) {
    let reversedPlatform = 0, reversedProvider = 0;
    const snapshot = platformFee(total);
    for (let previous = 0; previous < total; previous++) {
      const allocation = refund(total, previous, 1);
      reversedPlatform += allocation.platformReversalFen;
      reversedProvider += allocation.providerReversalFen;
      assert.equal(allocation.platformReversalFen + allocation.providerReversalFen, 1);
      assert.ok(allocation.platformReversalFen >= 0 && allocation.providerReversalFen >= 0);
      assert.equal(reversedPlatform + allocation.retainedPlatformFen, snapshot.amountFen);
      assert.equal(reversedProvider + allocation.retainedProviderFen, snapshot.providerAmountFen);
      assert.equal(allocation.retainedTotalFen + allocation.cumulativeRefundFen, total);
    }
    assert.equal(reversedPlatform, snapshot.amountFen);
    assert.equal(reversedProvider, snapshot.providerAmountFen);
  }
});
test('splitting partial refunds does not change retained shares, including maximum safe amounts', () => {
  for (const total of [3, 103, 10003, Number.MAX_SAFE_INTEGER]) {
    const firstAmount = Math.floor(total / 3), secondAmount = Math.floor(total / 2);
    const first = refund(total, 0, firstAmount), second = refund(total, firstAmount, secondAmount);
    const combined = refund(total, 0, firstAmount + secondAmount);
    assert.equal(first.platformReversalFen + second.platformReversalFen, combined.platformReversalFen);
    assert.equal(first.providerReversalFen + second.providerReversalFen, combined.providerReversalFen);
    assert.equal(second.retainedPlatformFen, combined.retainedPlatformFen);
    const final = refund(total, combined.cumulativeRefundFen, combined.retainedTotalFen);
    assert.equal(combined.platformReversalFen + final.platformReversalFen, platformFee(total).amountFen);
  }
});
test('unknown fee version, changed snapshot, invalid amounts and cumulative over-refund are rejected', () => {
  const input = { totalFen: 10000, platformFeeFen: 2000, feeRuleVersion: VERSION, previouslyRefundedFen: 0, refundFen: 1 };
  for (const patch of [{ feeRuleVersion: 'future' }, { platformFeeFen: 1999 }, { platformFeeFen: '2000' }]) {
    assert.throws(() => refundAllocation({ ...input, ...patch }), { code: 'REFUND_FEE_SNAPSHOT_MISMATCH' });
  }
  for (const patch of [{ previouslyRefundedFen: -1 }, { previouslyRefundedFen: '0' }, { previouslyRefundedFen: 10000 },
    { refundFen: 0 }, { refundFen: 1.5 }, { refundFen: '1' }, { refundFen: 10001 },
    { previouslyRefundedFen: 9999, refundFen: 2 }, { refundFen: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => refundAllocation({ ...input, ...patch }), { code: 'REFUND_AMOUNT_INVALID' });
  }
});
