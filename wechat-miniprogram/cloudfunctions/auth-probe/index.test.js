const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function probe(context) {
  const sandbox = { exports: {}, console: { info() {} }, require };
  vm.runInNewContext(fs.readFileSync(require.resolve('./index'), 'utf8'), sandbox);
  return () => sandbox.exports.main({}, { environment: JSON.stringify(context) });
}

test('rejects absent identity and identities from a different mini program', async () => {
  for (const context of [{}, { APPID: 'wxc94e1c1b38944511' }, { OPENID: 'private-user', APPID: 'other-app' }]) {
    const result = await probe(context)();
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'AUTH_CONTEXT_MISSING');
  }
});

test('returns verified company AppID without disclosing user identifiers', async () => {
  const result = await probe({ OPENID: 'private-user', APPID: 'wxc94e1c1b38944511', UNIONID: 'private-union' })();
  assert.equal(result.ok, true);
  assert.equal(result.data.appId, 'wxc94e1c1b38944511');
  assert.equal(result.data.authenticated, true);
  assert.equal(JSON.stringify(result).includes('private-'), false);
});
