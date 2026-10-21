const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const entries = ['account-api', 'availability-api', 'catalog-read', 'media-upload', 'media-security-submit', 'order-api', 'project-api', 'provider-catalog-draft', 'saved-items-api'];
function load(name, failure, stage = 'sdk') {
  const logs = [];
  const calls = { business: 0 };
  const handler = async () => { calls.business++; throw failure; };
  const sandbox = { exports: {}, process: { env: {} }, console: { error: value => logs.push(value) }, require(dependency) {
    if (dependency === '@cloudbase/node-sdk') {
      if (stage === 'sdk') throw failure;
      return { getCloudbaseContext: () => ({ WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted-test-caller' }),
        init: () => ({ rdb: () => ({}) }) };
    }
    if (dependency === 'wx-server-sdk') return { init() {} };
    if (dependency === './request-context') return require(path.join(__dirname, '../cloudfunctions', name, 'request-context.js'));
    if (dependency.startsWith('./')) return new Proxy({}, { get: (_, key) => key === 'createWxOpenApiAdapter' ? () => ({}) : handler });
    throw new Error('unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions', name, 'index.js'), 'utf8'), sandbox);
  return { main: sandbox.exports.main, logs, calls };
}
for (const name of entries) {
  test(`${name}: unknown upstream codes cannot leak or break the public error response`, async () => {
    const circular = { secret: 'sensitive-upstream' }; circular.self = circular;
    for (const code of ['sensitive-upstream', { secret: 'sensitive-upstream' }, circular, 'constructor', '__proto__', undefined]) {
      const { main, logs } = load(name, { code, message: 'sensitive-message', stack: 'sensitive-stack' });
      const result = await main({ action: 'sensitive-action' }, {});
      assert.equal(result.ok, false);
      assert.match(result.error.code, /_FAILED$/);
      assert.equal(logs.length, 1);
      assert.equal(JSON.parse(logs[0]).cause, 'UNEXPECTED');
      assert.doesNotMatch(JSON.stringify({ result, logs }), /sensitive-|constructor|__proto__/);
    }
  });
  test(`${name}: known validation code remains useful without internal details`, async () => {
    const known = name === 'catalog-read' ? 'INVALID_ARGUMENT' : 'VALIDATION_ERROR';
    const { main, logs } = load(name, { code: known, message: 'sensitive-message' });
    const result = await main({}, {});
    assert.equal(result.error.code, known);
    assert.equal(JSON.parse(logs[0]).cause, known);
    assert.doesNotMatch(JSON.stringify({ result, logs }), /sensitive-/);
  });
  test(`${name}: authenticated business failure does not expose private values`, async () => {
    const failure = { code: 'DATABASE_PRIVATE_FAILURE', message: 'sensitive-phone-13800138000',
      stack: 'sensitive-credentials', details: { url: 'https://example.test/file?token=sensitive-token' } };
    const { main, logs, calls } = load(name, failure, 'business');
    const result = await main({ action: 'getMine', privateBody: 'sensitive-body' }, {
      environment: JSON.stringify({ WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted-test-caller' })
    });
    assert.equal(calls.business, 1, 'must reach the business handler rather than fail at the identity gate');
    assert.equal(result.ok, false);
    assert.match(result.error.code, /_FAILED$/);
    assert.equal(JSON.parse(logs[0]).cause, 'UNEXPECTED');
    assert.doesNotMatch(JSON.stringify({ result, logs }), /sensitive-|13800138000|example\.test|DATABASE_PRIVATE_FAILURE/);
  });
  if (name !== 'catalog-read') test(`${name}: forged body identity cannot reach business handling`, async () => {
    for (const context of [{}, { environment: JSON.stringify({ WX_APPID: 'foreign-app', WX_OPENID: 'caller' }) }]) {
      const { main, calls } = load(name, { code: 'PRIVATE_FAILURE' }, 'business');
      const result = await main({ action: 'getMine', WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'forged-caller' }, context);
      assert.equal(result.error.code, 'AUTH_CONTEXT_MISSING');
      assert.equal(calls.business, 0);
    }
  });
}
