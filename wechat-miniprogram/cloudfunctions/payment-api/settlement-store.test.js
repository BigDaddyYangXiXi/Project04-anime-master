const { test } = require('node:test');
const assert = require('node:assert/strict');
const { prepareSettlement, claimSettlement, releaseSettlement } = require('./settlement-store');

test('invalid settlement input never opens a database transaction', async () => {
  const pool = { getConnection: async () => { assert.fail('must not connect'); } };
  for (const operation of [prepareSettlement, claimSettlement]) {
    for (const [id, now] of [[null, 1], ['', 1], ['order/foreign', 1], ['x'.repeat(65), 1],
      ['order_1', 0], ['order_1', NaN], ['order_1', Number.MAX_SAFE_INTEGER]]) {
      await assert.rejects(operation(pool, id, now), { code: 'SETTLEMENT_INPUT_INVALID' });
    }
  }
});

test('invalid settlement lease cannot release another worker', async () => {
  const pool = { execute: async () => { assert.fail('must not write'); } };
  for (const [id, token] of [[null, 'a'.repeat(32)], ['a'.repeat(32), ''], ['a'.repeat(32), 'forged']]) {
    await assert.rejects(releaseSettlement(pool, id, token), { code: 'SETTLEMENT_INPUT_INVALID' });
  }
});
