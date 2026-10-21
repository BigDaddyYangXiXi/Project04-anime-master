const test = require('node:test');
const assert = require('node:assert/strict');
const { preparePaymentSession } = require('./prepay-session');
const { createQueryFixture } = require('./test-query-fixture');
const { createNotificationFixture } = require('./test-notification-fixture');
const { agreementHash } = require('./payment-store');
const keys = createQueryFixture(createNotificationFixture().config);
const config = { ...keys.config, appid: 'wx_test', prepayEnabled: true, notifyUrl: 'https://example.test/payment' };
const now = 1790179200000, id = 'a'.repeat(32);
function fixture(patch = {}) {
  const order = { id: 'order_1', provider_id: 'provider', buyer_id: 'buyer', stage: 'BUYER_FINAL_CONFIRM',
    payload: { public: { paymentStatus: 'UNPAID', amountFen: 10000, buyerAgreementConfirmedAt: now - 1000,
      communicationDone: true, timePlaceConfirmed: true, serviceScopeConfirmed: true,
      amountConfirmed: true, executable: true, ndaRequired: false } } };
  const merchant = { status: 'READY', verified_at: 1, platform_mchid: config.platformMchid, sub_mchid: '1900000002' };
  const row = { id, order_id: order.id, agreement_hash: agreementHash(order), appid: config.appid, platform_mchid: config.platformMchid, sub_mchid: '1900000002',
    status: 'CREATED', amount_fen: 10000, currency: 'CNY', payer_openid: 'test_payer',
    prepay_started_at: 0, prepay_lease_until: 0, prepay_lease_token: null, prepay_id: null, ...patch };
  const connection = { async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async execute(sql, params) {
      if (sql.includes('FROM order_aggregates')) return [[order]];
      if (sql.includes('FROM provider_payment_merchants')) return [[merchant]];
      if (sql.startsWith('SELECT')) return [[{ ...row }]];
      assert.match(sql, /SET prepay_started_at/);
      [row.prepay_started_at, row.prepay_lease_until, row.prepay_lease_token] = params;
      return [{ affectedRows: 1 }];
    } };
  const pool = { async getConnection() { return connection; }, async execute(sql, params) {
    if (sql.startsWith('SELECT')) return [[{ ...row }]];
    if (sql.includes('SET prepay_started_at=0')) {
      if (row.prepay_lease_token !== params[1] || row.status !== 'CREATED' || row.prepay_id || row.prepay_recovery_started_at) return [{ affectedRows: 0 }];
      row.prepay_started_at = 0; row.prepay_lease_token = null; row.prepay_lease_until = 0;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('SET prepay_id')) {
      if (row.status !== 'CREATED' || row.prepay_lease_token !== params[2]) return [{ affectedRows: 0 }];
      row.prepay_id = params[0]; row.prepay_lease_token = null; row.prepay_lease_until = 0;
    } else if (row.prepay_lease_token === params[1]) {
      row.prepay_lease_token = null; row.prepay_lease_until = 0;
    }
    return [{ affectedRows: 1 }];
  } };
  return { pool, row, order, merchant };
}

test('persists prepay before returning phone arguments and reuses same reservation', async () => {
  const { pool, row } = fixture(); let submits = 0;
  const channel = async () => { submits++; return { prepayId: 'wx_reserved', paymentRequest: { package: 'prepay_id=wx_reserved' } }; };
  const result = await preparePaymentSession(pool, id, config, channel, () => now);
  assert.equal(result.status, 'READY'); assert.equal(row.prepay_id, 'wx_reserved');
  const reused = await preparePaymentSession(pool, id, config, channel, () => now + 1000);
  assert.equal(reused.paymentRequest.package, 'prepay_id=wx_reserved'); assert.equal(submits, 1);
});

for (const scenario of ['expired', 'replaced', 'insufficient-time']) test(`prepay never submits after claim becomes ${scenario}`, async () => {
  const { pool, row } = fixture();
  const connection = await pool.getConnection();
  let current = now, submits = 0;
  connection.commit = async () => {
    if (scenario === 'replaced') row.prepay_lease_token = 'f'.repeat(32);
    else current = now + (scenario === 'expired' ? 31000 : 29000);
  };
  const result = await preparePaymentSession(pool, id, config, async () => {
    submits++; return { prepayId: 'must_not_submit', paymentRequest: {} };
  }, () => current);
  assert.equal(submits, 0);
  assert.equal(result.status, scenario === 'replaced' ? 'QUERY_REQUIRED' : 'BUSY');
  assert.equal(row.prepay_started_at, scenario === 'replaced' ? now : 0);
  assert.equal(row.prepay_lease_token, scenario === 'replaced' ? 'f'.repeat(32) : null);
  if (scenario !== 'replaced') {
    connection.commit = async () => {};
    const retry = await preparePaymentSession(pool, id, config, async payment => {
      submits++; assert.equal(payment.id, id); return { prepayId: 'wx_retry', paymentRequest: {} };
    }, () => current);
    assert.equal(retry.status, 'READY'); assert.equal(submits, 1);
  }
});

test('unknown external outcome preserves id and requires query instead of duplicate submission', async () => {
  const { pool, row } = fixture(); let submits = 0;
  const channel = async () => { submits++; throw Object.assign(new Error('timeout'), { code: 'PAYMENT_QUERY_TIMEOUT' }); };
  await assert.rejects(preparePaymentSession(pool, id, config, channel, () => now), { code: 'PAYMENT_QUERY_TIMEOUT' });
  assert.equal(row.prepay_lease_token, null);
  assert.equal((await preparePaymentSession(pool, id, config, channel, () => now + 40000)).status, 'QUERY_REQUIRED');
  assert.equal(submits, 1);
});

test('active lease and expired prepay never trigger another channel request', async () => {
  const channel = () => assert.fail('must not submit');
  assert.equal((await preparePaymentSession(fixture({ prepay_started_at: now, prepay_lease_until: now + 1000 }).pool,
    id, config, channel, () => now)).status, 'BUSY');
  assert.equal((await preparePaymentSession(fixture({ prepay_id: 'wx_old', prepay_started_at: now - 7200000 }).pool,
    id, config, channel, () => now)).status, 'QUERY_REQUIRED');
});

test('payment callback winning the race prevents returning stale prepay arguments', async () => {
  const { pool, row } = fixture();
  const channel = async () => { row.status = 'PAID'; return { prepayId: 'wx_paid', paymentRequest: {} }; };
  await assert.rejects(preparePaymentSession(pool, id, config, channel, () => now), { code: 'PAYMENT_STATE_CHANGED' });
  assert.equal(row.prepay_id, null); assert.equal(row.status, 'PAID');
});

test('changed agreement blocks both new submission and cached phone arguments', async () => {
  for (const patch of [{}, { prepay_id: 'wx_cached', prepay_started_at: now - 1000 }]) {
    const { pool, order } = fixture(patch);
    order.payload.public.amountFen++;
    await assert.rejects(preparePaymentSession(pool, id, config,
      () => assert.fail('must not submit'), () => now), { code: 'PAYMENT_STATE_CHANGED' });
  }
});

test('changed recipient and revoked merchant readiness block submission', async () => {
  for (const patch of [{ status: 'PENDING' }, { verified_at: 0 }, { sub_mchid: '1900000003' }]) {
    const { pool, merchant } = fixture(); Object.assign(merchant, patch);
    await assert.rejects(preparePaymentSession(pool, id, config,
      () => assert.fail('must not submit'), () => now), { code: 'PAYMENT_MERCHANT_NOT_READY' });
  }
});

test('eligibility changes in flight retain channel id but withhold phone arguments', async () => {
  for (const kind of ['agreement', 'merchant']) {
    const { pool, row, order, merchant } = fixture();
    const channel = async () => {
      if (kind === 'agreement') order.payload.public.amountFen++;
      else merchant.status = 'PENDING';
      return { prepayId: 'wx_known', paymentRequest: {} };
    };
    await assert.rejects(preparePaymentSession(pool, id, config, channel, () => now),
      { code: kind === 'agreement' ? 'PAYMENT_STATE_CHANGED' : 'PAYMENT_MERCHANT_NOT_READY' });
    assert.equal(row.prepay_id, 'wx_known');
    assert.equal(row.prepay_lease_token, null);
  }
});
