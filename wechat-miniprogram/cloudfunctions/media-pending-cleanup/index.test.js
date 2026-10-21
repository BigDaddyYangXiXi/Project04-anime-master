const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const token = 'a'.repeat(64);
function load(env, caller = {}) {
  const state = { initialized: 0, runs: [] };
  const sandbox = { exports: {}, Buffer, process: { env }, console: { error() {} }, require(name) {
    if (name === './request-context') return () => caller;
    if (name === '@cloudbase/node-sdk') return { getCloudbaseContext: () => caller, init() {
      state.initialized++; return { rdb: () => ({}) };
    } };
    if (name === './cleanup-run-core') return { runCleanupJob: async (_db, _storage, _caller, event) => { state.runs.push(event); return {}; } };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  return { main: sandbox.exports.main, state };
}
const env = { SCF_NAMESPACE: 'cloudbase-d2g65rqbvee0bd978', MEDIA_CLEANUP_TOKEN: token };
test('missing identity, fake timer fields and wrong tokens never initialize cleanup storage', async () => {
  const { main, state } = load(env);
  for (const event of [undefined, {}, { Type: 'Timer', TriggerName: 'hourly' }, { cleanupToken: 'b'.repeat(64) }, { cleanupToken: token + 'a' }]) {
    assert.equal((await main(event)).error.code, 'CALLER_NOT_ALLOWED');
  }
  assert.equal(state.initialized, 0); assert.equal(state.runs.length, 0);
});
test('wrong environment or absent configuration remains closed', async () => {
  for (const config of [{}, { ...env, SCF_NAMESPACE: 'old-env' }, { ...env, MEDIA_CLEANUP_TOKEN: 'short' }]) {
    const { main, state } = load(config);
    assert.equal((await main({ cleanupToken: token })).error.code, 'CLEANUP_CONFIG_INVALID');
    assert.equal(state.initialized, 0);
  }
});
test('WeChat callers cannot trigger cleanup even with the internal token', async () => {
  for (const caller of [{ WX_OPENID: 'user' }, { OPENID: 'user' }]) {
    const { main, state } = load(env, caller);
    assert.equal((await main({ cleanupToken: token })).error.code, 'CALLER_NOT_ALLOWED');
    assert.equal(state.initialized, 0);
  }
});
test('explicit internal token permits existing job and is stripped before business handling', async () => {
  const { main, state } = load(env);
  assert.equal((await main({ cleanupToken: token, assetId: 'asset_test' })).ok, true);
  assert.equal(state.initialized, 1);
  assert.equal(state.runs[0].assetId, 'asset_test');
  assert.equal(Object.hasOwn(state.runs[0], 'cleanupToken'), false);
});
