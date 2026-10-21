const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function entry(caller, useOpenApi = false) {
  const calls = [];
  let wxLoads = 0, wxInitializations = 0, openApiCalls = 0;
  const sandbox = { exports: {}, process: { env: {} }, console: { error() {} }, require(name) {
    if (name === './request-context') return () => caller;
    if (name === './media-security-core') return { handleMediaSecurity: async (db, storage, api, event, identity) => { calls.push(identity); if (useOpenApi) return api.callWxOpenApi({ apiName: 'security.mediaCheckAsync' }); return {}; } };
    if (name === './wx-openapi-adapter') return { createWxOpenApiAdapter: () => ({ callWxOpenApi: async () => { openApiCalls++; return { result: { trace_id: 'trace' } }; } }) };
    if (name === 'wx-server-sdk') { wxLoads++; return { init() { wxInitializations++; } }; }
    if (name === '@cloudbase/node-sdk') return { getCloudbaseContext: () => caller,
      init: () => { calls.push('init'); return { rdb: () => ({}) }; } };
    throw Error('unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  return { main: sandbox.exports.main, calls, sdkCalls: () => ({ wxLoads, wxInitializations, openApiCalls }) };
}

test('status reads never load the WeChat OpenAPI SDK', async () => {
  for (const action of ['getImageStatus']) {
    const fixture = entry({ WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted' });
    assert.equal((await fixture.main({ action })).ok, true);
    assert.deepEqual(fixture.sdkCalls(), { wxLoads: 0, wxInitializations: 0, openApiCalls: 0 });
  }
});

test('review submission initializes OpenAPI before entering the submission handler', async () => {
  const fixture = entry({ WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted' }, true);
  assert.equal((await fixture.main({ action: 'submitImage' })).ok, true);
  assert.deepEqual(fixture.sdkCalls(), { wxLoads: 1, wxInitializations: 1, openApiCalls: 1 });
});

test('all media security actions reject missing or foreign identity before database initialization', async () => {
  for (const caller of [{}, { WX_APPID: 'other', WX_OPENID: 'user' },
    { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: {} },
    { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: '  ' }]) {
    for (const action of ['submitImage', 'getImageStatus']) {
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
    assert.equal((await main({ action: 'getImageStatus', OPENID: 'forged' })).ok, true);
    assert.equal(calls[1], caller);
  }
});

