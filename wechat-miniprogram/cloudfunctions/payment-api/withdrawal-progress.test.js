const test = require('node:test');
const assert = require('node:assert/strict');
const { withdrawalProgress } = require('./withdrawal-progress');
const part = (id, amountFen, status) => ({ id, amountFen, status });

test('large accumulated withdrawal has no channel daily ceiling', () => {
  const result = withdrawalProgress('120000000', []);
  assert.equal(result.remainingFen, '120000000');
  assert.equal(result.unallocatedFen, '120000000');
  assert.equal(result.status, 'UNPAID');
});
test('partial success and in-flight money are separate from unallocated money', () => {
  assert.deepEqual(withdrawalProgress('10000', [part('a', '3000', 'SUCCEEDED'), part('b', '2000', 'PROCESSING')]), {
    approvedNetFen: '10000', paidFen: '3000', inFlightFen: '2000', remainingFen: '7000',
    unallocatedFen: '5000', status: 'PARTIALLY_PAID', needsReview: false
  });
});
test('unknown and exported bank instructions stay reserved; terminal failures do not', () => {
  const result = withdrawalProgress('10000', [part('a', '3000', 'UNKNOWN'), part('b', '2000', 'EXPORTED'),
    part('c', '5000', 'FAILED'), part('d', '5000', 'CANCELLED')]);
  assert.equal(result.inFlightFen, '5000');
  assert.equal(result.unallocatedFen, '5000');
  assert.equal(result.needsReview, true);
  assert.equal(result.status, 'PROCESSING');
});
test('only full confirmed success is paid', () => {
  assert.equal(withdrawalProgress('10000', [part('a', '10000', 'PROCESSING')]).status, 'PROCESSING');
  assert.equal(withdrawalProgress('10000', [part('a', '4000', 'SUCCEEDED'), part('b', '6000', 'SUCCEEDED')]).status, 'PAID');
});
test('duplicate parts, overpayments and overallocated in-flight funds are rejected', () => {
  assert.throws(() => withdrawalProgress('100', [part('a', '30', 'SUCCEEDED'), part('a', '30', 'SUCCEEDED')]), /DUPLICATE/);
  for (const status of ['SUCCEEDED', 'PROCESSING', 'UNKNOWN', 'EXPORTED']) {
    assert.throws(() => withdrawalProgress('100', [part('a', '60', 'SUCCEEDED'), part('b', '41', status)]), /OVERALLOCATED/);
  }
});
test('integer strings preserve precision beyond JS number range', () => {
  const result = withdrawalProgress('9007199254740993', [part('a', '9007199254740992', 'SUCCEEDED')]);
  assert.equal(result.remainingFen, '1');
  assert.equal(result.status, 'PARTIALLY_PAID');
});
test('missing tax-approved net amount, malformed money and unsupported states fail closed', () => {
  for (const value of [undefined, null, true, '', '0', '-1', '01', '1.5', '1e5', 9007199254740992]) {
    assert.throws(() => withdrawalProgress(value, []), /INVALID/);
  }
  for (const row of [null, part('a', '0', 'SUCCEEDED'), part('a', '10', 'ACCEPTED'), part('', '10', 'SUCCEEDED')]) {
    assert.throws(() => withdrawalProgress('100', [row]), /INVALID/);
  }
});
