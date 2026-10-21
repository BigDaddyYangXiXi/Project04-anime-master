const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('slot runtime preserves strict TLS despite downgrade fields in configuration', async () => {
  let options, saved;
  const pool = {};
  const config = { host: 'db.example.test', database: 'orders', user: 'writer', password: 'test-only',
    ca: 'test-ca', ssl: false, rejectUnauthorized: false, verifyIdentity: false, minVersion: 'TLSv1' };
  const sandbox = { module: { exports: {} }, process: { env: { ORDER_MYSQL_CONFIG: JSON.stringify(config) } },
    require(name) {
      if (name === 'mysql2/promise') return { createPool(value) { options = value; return pool; } };
      if (name === './slot-store') return { async confirmWithSlots(connection, row, next) {
        saved = { connection, row, next }; return next;
      } };
      throw new Error('Unexpected dependency');
    } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/slot-runtime.js`, 'utf8'), sandbox);
  const row = { id: 'order_test', version: 1 }, next = { ...row, version: 2 };
  assert.equal(await sandbox.module.exports(row, next), next);
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(options.ssl.verifyIdentity, true);
  assert.equal(options.ssl.minVersion, 'TLSv1.2');
  assert.equal(options.ssl.ca, 'test-ca');
  assert.equal(options.multipleStatements, false);
  assert.equal(saved.connection, pool);
  assert.equal(saved.row, row);
});

test('private slot connection is confined to company target and non-root account', async () => {
  const base = { transport: 'company-vpc', host: '172.17.0.13', port: 3306,
    database: 'cloudbase-d2g65rqbvee0bd978', user: 'am_order', password: 'test-only' };
  async function run(config, namespace, encoded = false, conflict = false) {
    let options;
    const sandbox = { module: { exports: {} }, Buffer, process: { env: {
      ORDER_MYSQL_CONFIG: !encoded || conflict ? JSON.stringify(config) : undefined,
      ORDER_MYSQL_CONFIG_B64: encoded ? Buffer.from(JSON.stringify(config)).toString('base64') : undefined, SCF_NAMESPACE: namespace
    } }, require(name) {
      if (name === 'mysql2/promise') return { createPool(value) { options = value; return {}; } };
      if (name === './slot-store') return { async confirmWithSlots() { return true; } };
      throw new Error('Unexpected dependency');
    } };
    vm.runInNewContext(fs.readFileSync(`${__dirname}/slot-runtime.js`, 'utf8'), sandbox);
    try { await sandbox.module.exports({}, {}); return { options }; }
    catch (error) { return { code: error.code, options }; }
  }
  const namespace = 'cloudbase-d2g65rqbvee0bd978';
  assert.equal((await run(base, namespace)).options.ssl, undefined);
  assert.equal((await run(base, namespace, true)).options.ssl, undefined);
  assert.equal((await run(base, namespace, true, true)).code, 'SLOT_STORE_NOT_CONFIGURED');
  for (const override of [{ host: 'db.example.test' }, { host: '172.17.0.14' }, { port: 3307 },
    { database: 'other' }, { user: 'root' }, { transport: 'plain' }]) {
    const result = await run({ ...base, ...override }, namespace);
    assert.equal(result.code, 'SLOT_STORE_NOT_CONFIGURED');
    assert.equal(result.options, undefined);
  }
  for (const wrong of [undefined, 'other-env']) {
    const result = await run(base, wrong);
    assert.equal(result.code, 'SLOT_STORE_NOT_CONFIGURED');
    assert.equal(result.options, undefined);
  }
});
