const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../scripts/probes/sdk4-readonly.js'), 'utf8');
function probe(caller, response, mismatch = false, requestCaller = caller) {
  const calls = [], exports = {};
  const query = { select(value) { calls.push(['select', value]); return this; },
    eq(key, value) { calls.push(['eq', key, value]); return this; }, limit(value) { calls.push(['limit', value]); return Promise.resolve(response); } };
  vm.runInNewContext(code, { exports, process: { env: { SCF_NAMESPACE: 'cloudbase-d2g65rqbvee0bd978' }, version: 'test' },
    require(name) {
      if (name === '@cloudbase/node-sdk') return { getCloudbaseContext: () => caller, parseContext: () => ({ environment: requestCaller }),
        init: () => ({ rdb: () => ({ from: table => { calls.push(['from', table]); return query; } }) }) };
      if (name === 'wx-server-sdk') return { init() {}, getWXContext: () => ({ OPENID: mismatch ? 'other' : caller.WX_OPENID, APPID: caller.WX_APPID }) };
      if (name.endsWith('/package.json')) return { version: '4.1.0' };
      throw Error('UNEXPECTED_DEPENDENCY');
    } });
  return { main: exports.main, calls };
}
const identity = { WX_OPENID: 'trusted-fixture', WX_APPID: 'wxc94e1c1b38944511' };
test('stale process identity cannot authenticate an identity-free current request', async () => {
  const p = probe(identity, undefined, false, {});
  assert.equal((await p.main(identity, {})).code, 'AUTH_CONTEXT_MISSING'); assert.equal(p.calls.length, 0);
});
test('client identity cannot replace missing or foreign trusted context', async () => {
  for (const caller of [{}, { ...identity, WX_APPID: 'foreign' }]) {
    const p = probe(caller);
    assert.equal((await p.main(identity, {})).code, 'AUTH_CONTEXT_MISSING'); assert.equal(p.calls.length, 0);
  }
});
test('inconsistent SDK identities cannot query the database', async () => {
  const p = probe(identity, undefined, true);
  assert.equal((await p.main({}, {})).code, 'SDK_IDENTITY_MISMATCH'); assert.equal(p.calls.length, 0);
});
test('only trusted own identity is read and no identifiers are returned', async () => {
  const p = probe(identity, { data: [{ account_id: 'private-account' }] });
  const result = await p.main({ openId: 'attacker' }, {});
  assert.equal(result.ok, true); assert.equal(result.data.ownIdentityRows, 1);
  assert.deepEqual(p.calls, [['from', 'wechat_identities'], ['select', 'account_id'], ['eq', 'open_id', 'trusted-fixture'], ['limit', 1]]);
  assert.equal(JSON.stringify(result).includes('private-account'), false);
});
test('database errors and invalid response shapes cannot look like a successful empty read', async () => {
  for (const value of [{ error: { message: 'private' }, data: [] }, {}, { data: null }]) {
    const result = await probe(identity, value).main({}, {});
    assert.equal(result.code, 'RDB_RESPONSE_INVALID'); assert.equal(JSON.stringify(result).includes('private'), false);
  }
});
