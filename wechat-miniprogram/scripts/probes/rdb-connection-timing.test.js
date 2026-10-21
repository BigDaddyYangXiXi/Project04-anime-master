const test = require('node:test'), assert = require('node:assert/strict');
const { rdbConnectionTiming } = require('./rdb-connection-timing');
test('probe bounds reads and returns no row or credential data', async () => {
  let queries = 0;
  const sdk = { init(options) {
    assert.equal(options.keepalive, true); assert.equal(options.retries, 0);
    return { rdb: () => ({ from(table) { assert.equal(table, 'accounts'); return { select(column) {
      assert.equal(column, 'id'); return { async limit(count) { assert.equal(count, 1); queries++; return { data: [{ id: 'private-account' }] }; } };
    } }; } }) };
  } };
  const result = await rdbConnectionTiming({ keepalive: true, sql: 'ignored' }, sdk);
  assert.equal(queries, 3); assert.equal(result.times.length, 3); assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('private-account'), false);
  assert.equal((await rdbConnectionTiming({}, sdk)).code, 'INVALID_PROBE_INPUT');
});
test('probe failures never expose upstream error content', async () => {
  const result = await rdbConnectionTiming({ keepalive: false }, { init() { throw Error('secret'); } });
  assert.deepEqual(result, { ok: false, code: 'RDB_PROBE_FAILED', times: [] });
});

test('credential timing observes each original call without prefetch, caching or leaking tokens', async () => {
  let calls = 0;
  const credential = { access_token: 'private-token' };
  const auth = { async getClientCredential(argument) {
    assert.equal(this, auth); assert.equal(argument, 'original-option'); calls++; return credential;
  } };
  const app = {
    auth() { assert.equal(this, app); return auth; },
    rdb() { return { from() { return { select() { return { async limit() {
      assert.equal(await app.auth().getClientCredential('original-option'), credential);
      return { data: [] };
    } }; } }; } }; }
  };
  const result = await rdbConnectionTiming({ keepalive: false }, { init: () => app });
  assert.equal(result.ok, true); assert.equal(calls, 3);
  assert.equal(result.credentialTimes.length, 3);
  assert.ok(result.credentialTimes.every(value => Number.isSafeInteger(value) && value >= 0));
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('credential rejection is not retried or exposed', async () => {
  let calls = 0;
  const app = {
    auth: () => ({ async getClientCredential() { calls++; throw Error('private-upstream-response'); } }),
    rdb: () => ({ from: () => ({ select: () => ({ limit: () => app.auth().getClientCredential() }) }) })
  };
  const result = await rdbConnectionTiming({ keepalive: false }, { init: () => app });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, code: 'RDB_PROBE_FAILED', times: [] });
});
