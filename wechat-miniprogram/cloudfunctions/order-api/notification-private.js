const { ENV, verify } = require('./notification-rpc');
const { claimPersistedNotification } = require('./notification-claim');
const { recheckNotification } = require('./notification-recheck');
const { recordNotificationOutcome } = require('./notification-receipt');
const { listNotificationRecovery } = require('./notification-recovery');
let pool;

function database() {
  if (pool) return pool;
  const config = JSON.parse(Buffer.from(process.env.NOTIFICATION_MYSQL_CONFIG_B64 || '', 'base64').toString('utf8'));
  if (config.host !== '172.17.0.13' || config.database !== ENV || config.user !== 'am_notification'
    || config.transport !== 'company-vpc' || (config.port !== undefined && config.port !== 3306)
    || typeof config.password !== 'string' || !config.password) throw Error('NOTIFICATION_DATABASE_NOT_CONFIGURED');
  pool = require('mysql2/promise').createPool({ host: config.host, port: 3306, database: ENV, user: config.user,
    password: config.password, connectionLimit: 4, connectTimeout: 5000,
    supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  return pool;
}

async function handle(event, secret, db, now = Date.now()) {
  const { action, payload } = verify(event, ['claim', 'recheck', 'record', 'listRecovery'], secret, now);
  if (action === 'listRecovery') return listNotificationRecovery(db(), payload);
  if (action === 'claim') return claimPersistedNotification(db(), payload, now);
  if (action === 'recheck') return recheckNotification(db(), payload, now);
  if (!payload || Object.keys(payload).some(key => !['key', 'status'].includes(key))) throw Error('NOTIFICATION_RECEIPT_INVALID');
  return recordNotificationOutcome(db(), payload.key, payload.status, now);
}

exports.handle = handle;
exports.main = async event => {
  try {
    if (process.env.SCF_NAMESPACE !== ENV) throw Error('NOTIFICATION_CALL_REJECTED');
    return { ok: true, data: await handle(event, process.env.NOTIFICATION_RELAY_KEY, database) };
  } catch (_) { return { ok: false, code: 'NOTIFICATION_PRIVATE_UNAVAILABLE' }; }
};
