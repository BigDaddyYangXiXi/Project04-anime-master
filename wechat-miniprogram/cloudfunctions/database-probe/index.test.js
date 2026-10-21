const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect, main } = require('./index');
const config = { user: 'am_payment', host: '172.17.0.13', port: 3306,
  database: 'cloudbase-d2g65rqbvee0bd978', password: 'test-only' };
test('probe checks identity, empty reads, rollback and system table denial without writes', async () => {
  const calls = [];
  const connection = { async query({sql}) {
    calls.push(sql);
    if (sql.startsWith('SELECT DATABASE')) return [[{ db: config.database, actor: `${config.user}@172.17.0.0/255.255.240.0`, version: 'test' }]];
    if (sql.includes('mysql.user')) throw { errno: 1142 };
    return [[]];
  }, async beginTransaction() { calls.push('BEGIN'); }, async rollback() { calls.push('ROLLBACK'); }, async end() { calls.push('END'); } };
  const result = await inspect(config.user, config, async () => connection);
  assert.equal(result.systemTableDenied, true);
  assert.ok(result.tablesReadable.includes('order_funds_interlocks'));
  assert.ok(result.tablesReadable.includes('order_settlement_tasks'));
  assert.ok(calls.includes('SELECT order_id FROM order_funds_interlocks WHERE 1=0 FOR UPDATE'));
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.at(-1), 'END');
  assert.ok(calls.every(sql => /^(SELECT|BEGIN|ROLLBACK|END)/.test(sql)));
});
test('wrong database target cannot allocate a connection; wrong identity releases it', async () => {
  for (const patch of [{ host: 'other' }, { database: 'tcb' }, { port: 3307 }, { user: 'root' }]) {
    await assert.rejects(inspect(config.user, { ...config, ...patch }, () => assert.fail('must not connect')));
  }
  let ended = false;
  await assert.rejects(inspect(config.user, config, async () => ({
    query: async () => [[{ db: config.database, actor: 'root@%' }]], end: async () => { ended = true; }
  })));
  assert.equal(ended, true);
});
test('an empty unauthenticated event cannot invoke database inspection', async () => {
  assert.deepEqual(await main({}), { ok: false, code: 'FORBIDDEN' });
});
