const test = require('node:test');
const assert = require('node:assert/strict');
const { createPayment } = require('./payment-create');
const event = { action: 'createPayment', orderId: 'order_1', requestKey: 'request_key_00001', expectedVersion: 1 };
const caller = { WX_OPENID: 'trusted', WX_APPID: 'wx_test' };
const config = { appid: 'wx_test', prepayEnabled: true };
const pool = { execute() { assert.fail('must reject before database access'); } };

test('company direct collection remains blocked while the real payment switch is closed', async () => {
  await assert.rejects(createPayment(pool, event, caller, { ...config, paymentMode: 'DIRECT', prepayEnabled: false },
    () => assert.fail('must not prepare a channel payment')), { code: 'PAYMENT_PREPAY_NOT_ENABLED' });
});

test('approved direct mode still requires a registered buyer when explicitly enabled', async () => {
  let reads = 0;
  const missingBuyer = { async execute(sql, params) {
    reads++;
    assert.match(sql, /JOIN account_roles/);
    assert.deepEqual(params, ['trusted']);
    return [[]];
  } };
  await assert.rejects(createPayment(missingBuyer, event, caller, { ...config, paymentMode: 'DIRECT' },
    () => assert.fail('unregistered buyer cannot prepare payment')), { code: 'ACCOUNT_NOT_FOUND' });
  assert.equal(reads, 1);
});

test('public input cannot choose amount, payer, merchant or fee', async () => {
  for (const field of ['amountFen','buyerId','payerOpenid','platformMchid','subMchid','fee','feeRuleVersion','paymentRequest']) {
    await assert.rejects(createPayment(pool, { ...event, [field]: 'forged' }, caller, config), { code: 'PAYMENT_INPUT_INVALID' });
  }
});
test('missing trusted identity, foreign app and disabled product are blocked before writes', async () => {
  for (const actor of [{}, { ...caller, WX_APPID: 'foreign' }]) {
    await assert.rejects(createPayment(pool, event, actor, config), { code: 'AUTH_CONTEXT_MISSING' });
  }
  await assert.rejects(createPayment(pool, event, caller, { ...config, prepayEnabled: false }), { code: 'PAYMENT_PREPAY_NOT_ENABLED' });
});
test('malformed idempotency keys and versions cannot start a payment', async () => {
  for (const patch of [{ requestKey: 'short' }, { expectedVersion: 0 }, { expectedVersion: '1' }, { orderId: '../foreign' }, { action: 'refund' }]) {
    await assert.rejects(createPayment(pool, { ...event, ...patch }, caller, config), { code: 'PAYMENT_INPUT_INVALID' });
  }
});
