// Isolated capacity tests; synthetic approvals do not prove live financial approval.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const mysql = require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
const { reserveWithdrawalSources } = require('../cloudfunctions/payment-api/withdrawal-source-store');
if (process.env.PAYMENT_TEST_MYSQL_PORT !== '33317') throw Error('ISOLATED_LOCAL_PORT_REQUIRED');
const database = 'anime_withdrawal_source_' + crypto.randomBytes(8).toString('hex');
const id = () => crypto.randomBytes(16).toString('hex');
const config = { appid: 'test', platformMchid: 'merchant', providerId: 'provider' };
let admin, pool;
before(async () => {
  admin = await mysql.createConnection({ host: '127.0.0.1', port: 33317, user: 'root', password: '' });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ host: '127.0.0.1', port: 33317, user: 'root', password: '', database });
  // Only these parent identities are fixtures; net/request/source constraints use actual migrations.
  await pool.query('CREATE TABLE order_payments(id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,appid VARCHAR(64),platform_mchid VARCHAR(32))');
  await pool.query('CREATE TABLE fund_journals(id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY)');
  for (const file of ['0043_withdrawal_payment_progress.sql', '0051_finance_result_imports.sql',
    '0052_finance_net_settlements.sql', '0054_withdrawal_sources.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '../database/mysql', file), 'utf8');
    for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').filter(s => s.trim())) await pool.query(statement);
  }
  await pool.execute('INSERT INTO finance_result_imports VALUES(?,?,?,?,?,?,?,?,?,?)',
    ['a'.repeat(32), config.appid, config.platformMchid, 'test', 'b'.repeat(32), 'c'.repeat(64), 'd'.repeat(64), '{}', 'finance', 1]);
});
after(async () => {
  if (pool) await pool.end();
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end(); }
});
async function net(amount = '100', scope = config) {
  const paymentId = id();
  await pool.execute('INSERT INTO order_payments VALUES(?,?,?)', [paymentId, scope.appid, scope.platformMchid]);
  await pool.execute('INSERT INTO fund_journals VALUES(?)', ['net:' + paymentId]);
  await pool.execute('INSERT INTO finance_net_settlements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [paymentId, 'a'.repeat(32), 'net:' + paymentId, scope.providerId, 'c'.repeat(64), amount, 0, 0, 0, amount, 'finance', 1]);
  return paymentId;
}
async function request(amount, approved = true) {
  const requestId = id();
  await pool.execute('INSERT INTO withdrawal_requests VALUES(?,?,?,?,?,?,?,?,?,?)',
    [requestId, config.appid, config.platformMchid, config.providerId, amount,
      approved ? amount : null, approved ? 'fixture' : null, approved ? 'finance' : null, approved ? 2 : null, 1]);
  return requestId;
}
const source = (paymentId, amountFen) => ({ paymentId, amountFen });
test('different requests compete for the same income without exceeding net', async () => {
  const payment = await net(), first = await request('70'), second = await request('70');
  const results = await Promise.allSettled([first, second].map(r => reserveWithdrawalSources(pool, r, [source(payment, '70')], config)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /SOURCE_UNAVAILABLE/);
  await reserveWithdrawalSources(pool, await request('30'), [source(payment, '30')], config);
  await assert.rejects(reserveWithdrawalSources(pool, await request('1'), [source(payment, '1')], config), /SOURCE_UNAVAILABLE/);
});
test('twenty retries use one allocation; changes are rejected', async () => {
  const payment = await net(), requestId = await request('70'), sources = [source(payment, '70')];
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveWithdrawalSources(pool, requestId, sources, config)));
  assert.equal(results.filter(r => !r.alreadyReserved).length, 1);
  assert.ok(results.every(r => r.payable === false));
  assert.equal((await reserveWithdrawalSources(pool, requestId, sources, config)).alreadyReserved, true);
  await assert.rejects(reserveWithdrawalSources(pool, requestId, [source(await net(), '70')], config), /IDEMPOTENCY_MISMATCH/);
});
test('committed transaction with lost response is recovered without a second allocation', async () => {
  const payment = await net(), requestId = await request('70'), sources = [source(payment, '70')];
  const lostResponsePool = { async getConnection() {
    const connection = await pool.getConnection();
    return {
      beginTransaction: () => connection.beginTransaction(), execute: (...args) => connection.execute(...args),
      commit: async () => { await connection.commit(); throw Error('response lost after commit'); },
      rollback: () => connection.rollback(), release: () => connection.release(), destroy: () => connection.destroy()
    };
  } };
  await assert.rejects(reserveWithdrawalSources(lostResponsePool, requestId, sources, config), /response lost/);
  assert.equal((await reserveWithdrawalSources(pool, requestId, sources, config)).alreadyReserved, true);
  await reserveWithdrawalSources(pool, await request('30'), [source(payment, '30')], config);
  await assert.rejects(reserveWithdrawalSources(pool, await request('1'), [source(payment, '1')], config), /SOURCE_UNAVAILABLE/);
});
test('overlapping multi-source requests lock in a consistent order and corruption fails closed on retry', async () => {
  const payments = [await net(), await net()], requests = [await request('100'), await request('100')];
  const results = await Promise.all(requests.map((r, i) => reserveWithdrawalSources(pool, r,
    (i ? [...payments].reverse() : payments).map(p => source(p, '50')), config)));
  assert.ok(results.every(r => !r.alreadyReserved));
  await pool.execute('UPDATE finance_net_settlements SET provider_net_fen=99,income_tax_fen=1 WHERE payment_id=?', [payments[0]]);
  await assert.rejects(reserveWithdrawalSources(pool, requests[0], payments.map(p => source(p, '50')), config), /SOURCE_UNAVAILABLE/);
});
test('unapproved, missing, zero-net, foreign owner and foreign company cannot reserve', async () => {
  const payment = await net(), requestId = await request('1');
  await assert.rejects(reserveWithdrawalSources(pool, await request('1', false), [source(payment, '1')], config), /NOT_APPROVED/);
  for (const scope of [{ ...config, providerId: 'other' }, { ...config, appid: 'other' }, { ...config, platformMchid: 'other' }]) {
    await assert.rejects(reserveWithdrawalSources(pool, requestId, [source(await net('100', scope), '1')], config), /SOURCE_NOT_FOUND/);
    await assert.rejects(reserveWithdrawalSources(pool, requestId, [source(payment, '1')], scope), /WITHDRAWAL_NOT_FOUND/);
  }
  await assert.rejects(reserveWithdrawalSources(pool, requestId, [source(id(), '1')], config), /SOURCE_NOT_FOUND/);
  await assert.rejects(reserveWithdrawalSources(pool, requestId, [source(await net('0'), '1')], config), /SOURCE_UNAVAILABLE/);
});
test('incomplete totals and duplicate sources are rejected, and exact large cents are retained', async () => {
  const payment = await net('9007199254740991'), requestId = await request('9007199254740991');
  await assert.rejects(reserveWithdrawalSources(pool, requestId, [source(payment, '1')], config), /TOTAL_MISMATCH/);
  await assert.rejects(reserveWithdrawalSources(pool, requestId, [source(payment, '1'), source(payment, '1')], config), /INPUT_INVALID/);
  await reserveWithdrawalSources(pool, requestId, [source(payment, '9007199254740991')], config);
  const [[row]] = await pool.execute('SELECT CAST(amount_fen AS CHAR) AS amount FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
  assert.equal(row.amount, '9007199254740991');
});
test('late insertion failure rolls back earlier source reservations', async () => {
  const payments = [await net(), await net()].sort(), requestId = await request('100');
  await pool.query(`CREATE TRIGGER fail_source BEFORE INSERT ON withdrawal_sources FOR EACH ROW
    BEGIN IF NEW.payment_id='${payments[1]}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected source failure'; END IF; END`);
  try {
    await assert.rejects(reserveWithdrawalSources(pool, requestId, payments.map(p => source(p, '50')), config), /injected source failure/);
    const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM withdrawal_sources WHERE withdrawal_id=?', [requestId]);
    assert.equal(row.n, 0);
  } finally { await pool.query('DROP TRIGGER fail_source'); }
  await reserveWithdrawalSources(pool, requestId, payments.map(p => source(p, '50')), config);
});
