const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = require('../server-shared/request-context');
const identity = { WX_OPENID: 'current-user', WX_APPID: 'wxc94e1c1b38944511' };
test('current JSON and legacy contexts parse without using process or body identities', () => {
  assert.deepEqual(read({ environment: JSON.stringify(identity) }), identity);
  assert.deepEqual(read({ environ: 'OPENID=current-user;APPID=wxc94e1c1b38944511' }), { OPENID: 'current-user', APPID: identity.WX_APPID });
  for (const input of [undefined, {}, identity, { userInfo: identity }, { environment: '{' }, { environment: '[]' }, { environment: identity }]) assert.deepEqual(read(input), {});
  assert.deepEqual(read({ environment: JSON.stringify({ ...identity, WX_UNIONID: '' }) }), identity);
});
test('malformed identity values and conflicting aliases fail closed', () => {
  for (const extra of [{ OPENID: 'other' }, { APPID: 'foreign' }, { WX_OPENID: {} }, { WX_OPENID: '  ' }, { WX_APPID: ['app'] }]) {
    assert.deepEqual(read({ environment: JSON.stringify({ ...identity, ...extra }) }), {});
  }
});
test('all migrated user entries reject stale SDK identity before database or business work', async () => {
  const names = ['account-api', 'account-bootstrap', 'availability-api', 'media-upload', 'media-security-submit',
    'order-api', 'payment-api', 'project-api', 'provider-catalog-draft', 'saved-items-api', 'auth-probe'];
  for (const name of names) {
    let initialized = 0;
    const folder = path.resolve(__dirname, '../cloudfunctions', name);
    const entry = { exports: {}, Buffer, process: { env: { ...identity,
      PAYMENT_WECHAT_CONFIG: JSON.stringify({ appid: identity.WX_APPID }),
      PAYMENT_MYSQL_CONFIG: JSON.stringify({ host: 'fixture', user: 'fixture', database: 'fixture' }) } },
      console: { error() {}, info() {} }, require(dependency) {
        if (dependency === './request-context') return require(path.join(folder, 'request-context'));
        if (dependency === '@cloudbase/node-sdk') return { getCloudbaseContext: () => identity,
          init() { initialized++; throw Error('DATABASE_MUST_NOT_INITIALIZE'); } };
        if (dependency === 'wx-server-sdk') return { getWXContext: () => ({ OPENID: identity.WX_OPENID, APPID: identity.WX_APPID }), init() {} };
        if (dependency === 'mysql2/promise') return { createPool() { initialized++; throw Error('DATABASE_MUST_NOT_INITIALIZE'); } };
        if (dependency.startsWith('./')) return require(path.join(folder, dependency));
        return require(dependency);
      } };
    vm.runInNewContext(fs.readFileSync(path.join(folder, 'index.js'), 'utf8'), entry);
    const action = name === 'account-bootstrap' ? 'getSession' : name === 'payment-api' ? 'refreshPayment' : 'getMine';
    const result = await entry.exports.main({ action, ...identity, userInfo: identity }, { environment: '{}' });
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, 'AUTH_CONTEXT_MISSING', name);
    assert.equal(initialized, 0, name);
  }
});
