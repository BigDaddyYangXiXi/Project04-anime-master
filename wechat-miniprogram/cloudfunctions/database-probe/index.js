const { timingSafeEqual } = require('node:crypto');
const ENV = 'cloudbase-d2g65rqbvee0bd978';
const TABLES = {
  am_payment: ['accounts','wechat_identities','account_roles','provider_payment_merchants','order_aggregates','order_payments','order_settlement_tasks','order_funds_interlocks'],
  am_order: ['accounts','provider_qualifications','order_aggregates','provider_slot_locks']
};
function fail() { throw new Error('PROBE_FAILED'); }
async function inspect(user, config, createConnection) {
  if (!config || config.user !== user || config.host !== '172.17.0.13' || config.port !== 3306
    || config.database !== ENV || typeof config.password !== 'string' || !config.password) fail();
  const db = await createConnection({ host: config.host, port: 3306, database: ENV, user, password: config.password,
    connectTimeout: 5000, multipleStatements: false });
  try {
    const [[identity]] = await db.query({ sql: 'SELECT DATABASE() AS db, CURRENT_USER() AS actor, VERSION() AS version', timeout: 3000 });
    if (identity.db !== ENV || identity.actor !== `${user}@172.17.0.0/255.255.240.0`) fail();
    for (const table of TABLES[user]) await db.query({ sql: `SELECT 1 FROM \`${table}\` LIMIT 0`, timeout: 3000 });
    await db.beginTransaction();
    try {
      await db.query({ sql: 'SELECT id FROM order_aggregates WHERE 1=0 FOR UPDATE', timeout: 3000 });
      if (user === 'am_payment') await db.query({ sql: 'SELECT order_id FROM order_funds_interlocks WHERE 1=0 FOR UPDATE', timeout: 3000 });
    } finally { await db.rollback(); }
    let systemTableDenied = false;
    try { await db.query({ sql: 'SELECT User FROM mysql.user LIMIT 0', timeout: 3000 }); }
    catch (error) { if ([1142,1143].includes(error.errno)) systemTableDenied = true; else throw error; }
    if (!systemTableDenied) fail();
    return { account: user, databaseMatched: true, identityMatched: true, tablesReadable: TABLES[user],
      emptyLockTransactionRolledBack: true, systemTableDenied, serverVersion: identity.version };
  } finally { await db.end(); }
}

exports.inspect = inspect;
exports.main = async event => {
  const expected = process.env.DATABASE_PROBE_TOKEN, supplied = event?.token;
  if (process.env.SCF_NAMESPACE !== ENV || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
    || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
    || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return { ok: false, code: 'FORBIDDEN' };
  try {
    const config = JSON.parse(Buffer.from(process.env.DATABASE_PROBE_ACCOUNTS_B64 || '', 'base64').toString('utf8'));
    const mysql = require('mysql2/promise');
    const results = [];
    for (const user of Object.keys(TABLES)) results.push(await inspect(user, config?.[user], mysql.createConnection));
    return { ok: true, results, scope: 'Identity, empty reads and lock transaction rollback only; no business row changes or payment.' };
  } catch (error) {
    return { ok: false, code: [1044,1045].includes(error.errno) ? 'DATABASE_AUTH_DENIED'
      : [1142,1143].includes(error.errno) ? 'DATABASE_PERMISSION_DENIED' : 'DATABASE_PROBE_FAILED' };
  }
};
