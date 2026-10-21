const { verifyRelayRequest } = require('./relay-auth');
function fail() { const error = new Error('PAYMENT_RELAY_REJECTED'); error.code = error.message; throw error; }

// Must commit before the public relay opens HTTPS. Unknown INSERT outcome never grants permission.
async function consumeMutation(pool, event, config, clock = Date.now) {
  if (!config || config.enabled !== true || config.mutationsEnabled !== true || !event
    || Object.keys(event).some(key => !['path','body','authorization'].includes(key))
    || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 65536
    || typeof event.path !== 'string'
    || !/^\/v3\/(?:(?:combine-transactions|pay\/transactions)\/(?:jsapi|out-trade-no\/[a-f0-9]{32}\/close)|ecommerce\/profitsharing\/orders|refund\/domestic\/refunds)$/.test(event.path)) fail();
  if (event.path === '/v3/refund/domestic/refunds' && config.refundEnabled !== true) fail();
  const now = clock();
  const hash = verifyRelayRequest('POST', event, event.body, config, now);
  try {
    await pool.execute('INSERT INTO payment_mutation_receipts(request_hash,consumed_at) VALUES(?,?)', [hash, now]);
    return true;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return false;
    throw error;
  }
}

async function consumeThroughPrivateGuard(event) {
  const cloud = require('@cloudbase/node-sdk').init({ env: 'cloudbase-d2g65rqbvee0bd978', timeout: 2000, retries: 0 });
  let timer;
  try {
    const reply = await Promise.race([cloud.callFunction({ name: 'payment-mutation-guard', data: event }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('GUARD_TIMEOUT')), 2000); })]);
    return reply?.result?.ok === true && reply.result.consumed === true;
  } finally { clearTimeout(timer); }
}

module.exports = { consumeMutation, consumeThroughPrivateGuard };

let pool;
module.exports.main = async event => {
  try {
    if (process.env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978') fail();
    const config = JSON.parse(Buffer.from(process.env.PAYMENT_MUTATION_GUARD_CONFIG_B64 || '', 'base64').toString('utf8'));
    const db = JSON.parse(Buffer.from(process.env.PAYMENT_MYSQL_CONFIG_B64 || '', 'base64').toString('utf8'));
    if (!config || config.enabled !== true || config.mutationsEnabled !== true || db?.transport !== 'company-vpc'
      || db.host !== '172.17.0.13' || db.port !== 3306 || db.database !== process.env.SCF_NAMESPACE
      || db.user !== 'am_payment' || typeof db.password !== 'string' || !db.password) fail();
    if (!pool) pool = require('mysql2/promise').createPool({ host: db.host, port: db.port, database: db.database,
      user: db.user, password: db.password, connectionLimit: 4, connectTimeout: 1000, multipleStatements: false });
    const { userInfo, tcbContext, ...request } = event || {};
    return { ok: true, consumed: await consumeMutation(pool, request, config) };
  } catch { return { ok: false, code: 'PAYMENT_MUTATION_GUARD_FAILED' }; }
};
