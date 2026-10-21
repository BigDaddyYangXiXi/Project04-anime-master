const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { normalizeNickname, identityKey, NOTICE_VERSION } = require('./identity-core');
function entry(failure, caller = { WX_OPENID: 'trusted', WX_APPID: 'wxc94e1c1b38944511' }, clock = Date) {
  const records = { logs: [], sdkReads: 0, actions: [], externalCalls: 0, databaseInits: 0 };
  const handler = name => async () => {
    records.actions.push(name);
    if (failure) throw failure;
    return { registered: true, account: { id: 'test-account' } };
  };
  const sandbox = { Date: clock, exports: {}, process: { env: {} }, console: {
    info: value => records.logs.push(value), error: value => records.logs.push(value)
  }, require(name) {
    if (name === './request-context') return () => caller;
    if (name === './account-names') return require('./account-names');
    if (name === './identity-core') return { identityKey, normalizeNickname, NOTICE_VERSION, loginAccount: handler('login'), readSession: handler('getSession'), registerAccount: handler('register') };
    if (name === './nickname-security') return { reviewNickname: async () => { records.externalCalls++; } };
    if (name === './phone-core') return { loginByPhone: handler('phoneLogin'), registerByPhone: handler('phoneRegister') };
    if (name === './wx-phone-adapter') return { createWxPhoneAdapter: () => ({ getPhoneNumber: async () => { records.externalCalls++; return {}; } }) };
    if (name === 'wx-server-sdk') return { init() {} };
    if (name === '@cloudbase/node-sdk') { records.sdkReads++; return { getCloudbaseContext: () => caller, init: () => { records.databaseInits++; return { rdb: () => ({from:()=>({select:()=>({eq:async()=>({data:[]})})})}) }; } }; }
    throw new Error('unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  return { main: sandbox.exports.main, records };
}

test('unsupported actions are rejected before SDK access and never echoed to logs', async () => {
  for (const action of ['private-phone-secret', { secret: 'private-phone-secret' }, ['private-phone-secret'], 'constructor']) {
    const { main, records } = entry();
    const result = await main({ action, phoneCode: 'private-code' }, {});
    assert.equal(result.error.code, 'UNSUPPORTED_ACTION');
    assert.equal(records.sdkReads, 0);
    assert.doesNotMatch(JSON.stringify(records.logs), /private-phone-secret|private-code|constructor/);
  }
});

test('unexpected upstream codes and prototype property names cannot escape through errors or logs', async () => {
  for (const code of ['private-upstream-secret', 'constructor', '__proto__', { secret: 'private-upstream-secret' }]) {
    const { main, records } = entry({ code, message: 'private-message' });
    const result = await main({ action: 'login' }, {});
    assert.equal(result.error.code, 'ACCOUNT_AUTH_FAILED');
    assert.equal(typeof result.error.message, 'string');
    assert.doesNotMatch(JSON.stringify({ result, logs: records.logs }), /private-upstream-secret|private-message|constructor|__proto__/);
  }
});

test('known account errors remain actionable', async () => {
  const { main } = entry({ code: 'ACCOUNT_SUSPENDED' });
  const result = await main({ action: 'login' }, {});
  assert.equal(result.error.code, 'ACCOUNT_SUSPENDED');
  assert.match(result.error.message, /暂停/);
});

test('supported actions and the default login still reach their original handlers', async () => {
  for (const action of ['login', 'getSession', 'phoneLogin', 'phoneRegister']) {
    const { main, records } = entry();
    assert.equal((await main({ action, username: 'testuser', nickname: '测试昵称', acceptedNotice: true, noticeVersion: NOTICE_VERSION }, {})).ok, true);
    assert.deepEqual(records.actions, [action]);
  }
  const { main, records } = entry();
  assert.equal((await main(undefined, {})).ok, true);
  assert.deepEqual(records.actions, ['login']);
});

test('null and non-object events return a structured rejection', async () => {
  for (const event of [null, [], 'private-event']) {
    const { main, records } = entry();
    const result = await main(event, {});
    assert.equal(result.error.code, 'UNSUPPORTED_ACTION');
    assert.equal(records.sdkReads, 0);
  }
});

test('foreign or absent trusted company identity cannot reach nickname, phone or database services', async () => {
  for (const caller of [{}, { WX_OPENID: 'trusted', WX_APPID: 'foreign_app' },
    { WX_APPID: 'wxc94e1c1b38944511' }, { WX_OPENID: {}, WX_APPID: 'wxc94e1c1b38944511' }]) {
    for (const action of ['login','getSession','register','phoneLogin','phoneRegister']) {
      const { main, records } = entry(undefined, caller);
      const result = await main({ action, nickname: '测试昵称', acceptedNotice: true, noticeVersion: NOTICE_VERSION,
        OPENID: 'forged', APPID: 'wxc94e1c1b38944511', userInfo: { openId: 'forged' } }, {});
      assert.equal(result.error?.code, 'AUTH_CONTEXT_MISSING');
      assert.equal(records.externalCalls, 0); assert.equal(records.databaseInits, 0);
      assert.deepEqual(records.actions, []);
    }
  }
});

test('legacy no-phone registration is rejected before writes or review',async()=>{const {main,records}=entry();const result=await main({action:'register'},{});assert.equal(result.error.code,'PHONE_AUTH_REQUIRED');assert.equal(records.databaseInits,0);assert.equal(records.externalCalls,0);});

test('session timing separates handler stages without exposing identity or changing other responses', async () => {
  const ticks = [0, 5, 12, 23];
  const { main } = entry(undefined, undefined, { now: () => ticks.shift() });
  const result = await main({ action: 'getSession' }, {});
  assert.deepEqual(JSON.parse(JSON.stringify(result.serverTiming)), { sdkLoadMs: 5, initMs: 7, readMs: 11 });
  assert.equal(result.data.account.id, 'test-account');
  assert.equal((await entry().main({ action: 'login' }, {})).serverTiming, undefined);
  assert.equal((await entry(undefined, {}).main({ action: 'getSession' }, {})).serverTiming, undefined);
  assert.equal((await entry({ code: 'ACCOUNT_SUSPENDED' }).main({ action: 'getSession' }, {})).serverTiming, undefined);
});
