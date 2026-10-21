const test = require('node:test');
const assert = require('node:assert/strict');
const { readWithdrawalProgress } = require('./withdrawal-progress-store');
const { withdrawalReceiptHash } = require('./withdrawal-receipt-hash');
const id = 'a'.repeat(32), config = { appid: 'wx_test', platformMchid: 'merchant' };
function fixture(net = '10000', parts = [], found = true) {
  const events = [];
  const connection = {
    async query(sql) { events.push(sql); },
    async execute(sql, params) {
      assert.match(sql, /^SELECT /); events.push('select');
      if (sql.includes('FROM withdrawal_requests')) {
        assert.deepEqual(params, [id, 'provider', 'wx_test', 'merchant']);
        assert.match(sql, /CAST\(approved_net_fen AS CHAR\)/);
        return [found ? [{ approved_net_fen: net }] : []];
      }
      if(sql.includes('FROM withdrawal_receipt_events'))return [parts.filter(p=>p.status==='SUCCEEDED').map(p=>({
        payment_id:p.id,resulting_status:p.status,platform_mchid:config.platformMchid,operator_id:'finance',evidence_reference:'synthetic-proof',
        bank_transaction_reference:'synthetic-'+p.id,input_sha256:withdrawalReceiptHash({requestId:id,paymentId:p.id,
          providerId:'provider',accountVersionId:p.account_version_id,amountFen:p.amountFen,operatorId:'finance',status:'SUCCEEDED',
          evidenceReference:'synthetic-proof',bankTransactionReference:'synthetic-'+p.id},config)
      }))];
      assert.match(sql, /FROM withdrawal_bank_payments/);
      assert.match(sql, /CAST\(amount_fen AS CHAR\)/);
      assert.deepEqual(params, [id]); return [parts];
    },
    async commit() { events.push('commit'); }, async rollback() { events.push('rollback'); },
    release() { events.push('release'); }, destroy() { events.push('destroy'); }
  };
  return { pool: { async getConnection() { return connection; } }, events, connection };
}
test('reads full request and partial payments in one readonly snapshot without payment authorization', async () => {
  const f = fixture('10000', [{ id: 'p1', amountFen: '3000', status: 'SUCCEEDED' }, { id: 'p2', amountFen: '2000', status: 'UNKNOWN' }]);
  const result = await readWithdrawalProgress(f.pool, id, 'provider', config);
  assert.equal(result.progress.unallocatedFen, '5000');
  assert.equal(result.progress.needsReview, true);
  assert.equal(result.payable, false);
  assert.deepEqual(f.events.slice(0, 2), ['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION READ ONLY']);
  assert.deepEqual(f.events.slice(-2), ['commit', 'release']);
});
test('unapproved withdrawal never becomes a payable instruction', async () => {
  const f = fixture(null);
  const result = await readWithdrawalProgress(f.pool, id, 'provider', config);
  assert.equal(result.status, 'AWAITING_APPROVAL'); assert.equal(result.progress, null);
  assert.equal(f.events.filter(x => x === 'select').length, 1);
});
test('missing scoped request does not read payments', async () => {
  const f = fixture('10000', [], false);
  await assert.rejects(readWithdrawalProgress(f.pool, id, 'provider', config), /NOT_FOUND/);
  assert.equal(f.events.filter(x => x === 'select').length, 1);
  assert.deepEqual(f.events.slice(-2), ['rollback', 'release']);
});
test('overpayment is an integrity failure, not negative remaining money', async () => {
  const f = fixture('100', [{ id: 'p1', amountFen: '101', status: 'SUCCEEDED' }]);
  await assert.rejects(readWithdrawalProgress(f.pool, id, 'provider', config), /OVERALLOCATED/);
  assert.ok(!f.events.includes('commit'));
});
test('failed rollback discards connection', async () => {
  const f = fixture(); f.connection.execute = async () => { throw Error('read failed'); };
  f.connection.rollback = async () => { throw Error('rollback failed'); };
  await assert.rejects(readWithdrawalProgress(f.pool, id, 'provider', config), /read failed/);
  assert.equal(f.events.at(-1), 'destroy');
});
test('invalid identity fails before database acquisition', async () => {
  const pool = { getConnection() { assert.fail('must not connect'); } };
  await assert.rejects(readWithdrawalProgress(pool, id, '', config), /INPUT_INVALID/);
  await assert.rejects(readWithdrawalProgress(pool, id, 'provider', {}), /INPUT_INVALID/);
});
