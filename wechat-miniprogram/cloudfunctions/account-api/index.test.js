const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function entry(caller) {
  const calls = [];
  const sandbox = { exports: {}, process: { env: {} }, console: { error() {} }, require(name) {
    if (name === './request-context') return () => caller;
    if (name === './account-core') return { handleAccount: async (db, event, identity) => { calls.push(identity); return {}; } };
    if (name === './nickname-security') return {};
    if (name === './location-resolver') return {};
    if (name === '@cloudbase/node-sdk') return { getCloudbaseContext: () => caller,
      init: () => { calls.push('init'); return { rdb: () => ({}) }; } };
    throw Error('unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  return { main: sandbox.exports.main, calls };
}

test('all account actions reject missing or foreign identity before database initialization', async () => {
  for (const caller of [{}, { WX_APPID: 'other', WX_OPENID: 'user' },
    { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: {} },
    { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: '  ' }]) {
    for (const action of ['getMine', 'updateMine', 'getDiscoveryPreference', 'saveDiscoveryPreference', 'resolveDiscoveryLocation']) {
      const { main, calls } = entry(caller);
      const result = await main({ action, APPID: 'wxc94e1c1b38944511', OPENID: 'forged', userInfo: { openId: 'forged' } });
      assert.equal(result.error?.code, 'AUTH_CONTEXT_MISSING');
      assert.deepEqual(calls, []);
    }
  }
});

test('company SDK identity reaches the handler unchanged despite forged event identity', async () => {
  for (const caller of [{ WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted' },
    { APPID: 'wxc94e1c1b38944511', OPENID: 'trusted' }]) {
    const { main, calls } = entry(caller);
    assert.equal((await main({ action: 'getMine', OPENID: 'forged' })).ok, true);
    assert.equal(calls[1], caller);
  }
});
