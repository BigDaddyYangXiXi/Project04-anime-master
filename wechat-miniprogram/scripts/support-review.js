// Operator-only local entry. Never exposed through support-api.
const fs = require('node:fs');
const { replyPatch } = require('../cloudfunctions/support-api/support-core');
async function listQueue(pool, cursor = null) {
  if (cursor && (!Number.isSafeInteger(cursor.time) || cursor.time < 0 || typeof cursor.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(cursor.id))) throw Object.assign(new Error(), { code: 'VALIDATION_ERROR' });
  const [rows] = await pool.execute("SELECT id,account_id,kind,status,version,created_at,updated_at FROM support_requests WHERE status IN ('PENDING','PROCESSING')" + (cursor ? ' AND (created_at>? OR (created_at=? AND id>?))' : '') + ' ORDER BY created_at,id LIMIT 101', cursor ? [cursor.time, cursor.time, cursor.id] : []);
  const items = rows.slice(0, 100), last = items.at(-1);
  return { items, cursor: rows.length > 100 ? { time: Number(last.created_at), id: last.id } : null };
}
async function review(pool, input, operatorId, now = Date.now()) {
  if (typeof operatorId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(operatorId)) throw Object.assign(new Error(), { code: 'OPERATOR_ID_REQUIRED' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM support_requests WHERE id=? AND account_id=? FOR UPDATE', [input.id, input.accountId]);
    if (!rows.length) throw Object.assign(new Error(), { code: 'REQUEST_NOT_FOUND' });
    const row = rows[0], patch = replyPatch(row, { ...input, operatorId }, now);
    if (patch) {
      const [result] = await connection.execute('UPDATE support_requests SET payload=?,status=?,version=?,updated_at=? WHERE id=? AND account_id=? AND version=?', [patch.payload, patch.status, patch.version, patch.updated_at, row.id, row.account_id, row.version]);
      if (result.affectedRows !== 1) throw Object.assign(new Error(), { code: 'VERSION_CONFLICT' });
    }
    await connection.commit();
    return { id: row.id, status: patch?.status || row.status, version: patch?.version || Number(row.version), repeated: !patch };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
async function main() {
  const [mode, file] = process.argv.slice(2);
  if (!['--list', '--read', '--reply'].includes(mode) || mode !== '--list' && !file) throw new Error('Use --list [cursor.json], --read <id>, or --reply <decision.json>');
  const config = JSON.parse(process.env.SUPPORT_MYSQL_CONFIG || 'null');
  if (!config?.host || !config.database || !config.user || typeof config.password !== 'string') throw new Error('SUPPORT_MYSQL_CONFIG required');
  const pool = require('../cloudfunctions/payment-api/node_modules/mysql2/promise').createPool({
    host: config.host, port: config.port || 3306, database: config.database, user: config.user, password: config.password,
    ssl: { rejectUnauthorized: true, verifyIdentity: true, ...(config.ca ? { ca: config.ca } : {}) }, connectionLimit: 1, multipleStatements: false
  });
  try {
    if (mode === '--reply') console.log(JSON.stringify(await review(pool, JSON.parse(fs.readFileSync(file, 'utf8')), process.env.SUPPORT_OPERATOR_ID)));
    else if (mode === '--list') console.log(JSON.stringify(await listQueue(pool, file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null), null, 2));
    else {
      const [rows] = await pool.execute('SELECT * FROM support_requests WHERE id=?', [file]);
      console.log(JSON.stringify(rows, null, 2));
    }
  } finally { await pool.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.code || 'SUPPORT_REVIEW_FAILED'); process.exitCode = 1; });
module.exports = { review, listQueue };
