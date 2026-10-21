// Isolated localhost SQL validation; no cloud configuration or storage calls.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('../cloudfunctions/order-api/node_modules/mysql2/promise');
const { UNCOMMITTED_TTL_MS, COMMITTED_TTL_MS } = require('../cloudfunctions/media-pending-cleanup/cleanup-core');
const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('EXPLICIT_LOCAL_TEST_PORT_REQUIRED');
const database = 'anime_media_test_' + crypto.randomBytes(8).toString('hex');
const now = 2_000_000_000_000;
let connection;
before(async () => {
  connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: process.env.PAYMENT_TEST_MYSQL_PASSWORD || '' });
  await connection.query(`CREATE DATABASE \`${database}\``);
  await connection.query(`USE \`${database}\``);
  for (const name of ['0001_identity_core.sql', '0002_catalog_core.sql']) {
    // The first CREATE TABLE defines accounts/media_assets respectively.
    const sql = fs.readFileSync(path.join(__dirname, '../database/mysql', name), 'utf8').split(';')[0];
    await connection.query(sql);
  }
  await connection.query(fs.readFileSync(path.join(__dirname, '../database/mysql/0033_media_cleanup_expiry_indexes.sql'), 'utf8'));
  await connection.execute('INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES (?,?,?,?,?)', ['owner','AM_TEST','test',1,1]);
  for (const [id,status,committed,deleted] of [
    ['recent-review','PENDING',now - 1000,null], ['expired-upload','PENDING',null,null],
    ['expired-review','PENDING',now - COMMITTED_TTL_MS - 1,null],
    ['ready','READY',1,null], ['retry','REJECTED',1,1], ['moderation','REJECTED',1,null]
  ]) {
    await connection.execute('INSERT INTO media_assets (id,owner_account_id,storage_key,mime_type,size_bytes,status,created_at,committed_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id,'owner','user-uploads/test/'+id,'image/png',1,status,1,committed,deleted]);
  }
});
after(async () => {
  if (connection) {
    try { await connection.query(`DROP DATABASE IF EXISTS \`${database}\``); }
    finally { await connection.end(); }
  }
});
const cases = [
  ['uncommitted', "status='PENDING' AND committed_at IS NULL AND created_at < ?", now - UNCOMMITTED_TTL_MS, 'expired-upload', 'media_assets_pending_expiry_idx'],
  ['committed', "status='PENDING' AND committed_at < ?", now - COMMITTED_TTL_MS, 'expired-review', 'media_assets_pending_expiry_idx'],
  ['retry', "status='REJECTED' AND deleted_at > 0 AND deleted_at < ?", now - UNCOMMITTED_TTL_MS, 'retry', 'media_assets_delete_retry_idx']
];
for (const [name, where, cutoff, expected, index] of cases) {
  test(`${name} SQL filters before LIMIT and has an eligible expiry index`, async () => {
    const [rows] = await connection.execute(`SELECT id FROM media_assets WHERE ${where} LIMIT 1`, [cutoff]);
    assert.deepEqual(rows.map(row => row.id), [expected]);
    const [plan] = await connection.execute(`EXPLAIN SELECT id FROM media_assets WHERE ${where} LIMIT 1`, [cutoff]);
    assert.ok((plan[0].possible_keys || '').split(',').includes(index));
    const [other] = await connection.execute(`SELECT id FROM media_assets WHERE ${where} AND id=? LIMIT 1`, [cutoff,'ready']);
    assert.equal(other.length, 0);
  });
}
