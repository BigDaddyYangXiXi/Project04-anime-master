const { test } = require('node:test');
const assert = require('node:assert/strict');
const { executeSettlement } = require('./settlement-executor');

test('settlement execution defaults off and missing risk interlock fails before database access', async () => {
  const pool = { getConnection() { assert.fail('must not connect'); } };
  assert.deepEqual(await executeSettlement(pool, 'order_1', {}), { enabled: false });
  await assert.rejects(executeSettlement(pool, 'order_1', {
    settlementExecutionEnabled: true, settlementEnabled: true
  }), { code: 'SETTLEMENT_EXECUTION_NOT_CONFIGURED' });
});
