const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function entry(caller, failure) {
  const calls = [];
  const sandbox = { exports: {}, process: { env: {} }, console: { error() {} }, require(name) {
    if (name === './request-context') return () => caller;
    if (name === './media-core') return { handleMediaUpload: async (db, storage, event, identity) => { calls.push(identity); if (failure) throw failure; return {}; } };


    if (name === '@cloudbase/node-sdk') return { getCloudbaseContext: () => caller,
      init: () => { calls.push('init'); return { rdb: () => ({}) }; } };
    throw Error('unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`, 'utf8'), sandbox);
  return { main: sandbox.exports.main, calls };
}

test('all media upload actions reject missing or foreign identity before database initialization', async () => {
  for (const caller of [{}, { WX_APPID: 'other', WX_OPENID: 'user' },
    { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: {} },
    { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: '  ' }]) {
    for (const action of ['prepareUpload', 'commitUpload', 'cancelUpload', 'getOwnedMedia']) {
      const { main, calls } = entry(caller);
      const result = await main({ action, APPID: 'wxc94e1c1b38944511', OPENID: 'forged', userInfo: { openId: 'forged' } });
      assert.equal(result.error?.code, 'AUTH_CONTEXT_MISSING');
      assert.deepEqual(calls, []);
    }
  }
});

test('删除诊断只返回固定原因，未知错误正文不能进入客户端', async () => {
  const caller = { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted' };
  for (const reason of ['STORAGE_NONEXIST', 'private-sentinel']) {
    const { main } = entry(caller, { code: 'MEDIA_DELETE_FAILED', reason, message: 'private-sentinel' });
    const result = await main({ action: 'cancelUpload' });
    assert.equal(result.error.reason, reason === 'STORAGE_NONEXIST' ? reason : undefined);
    assert.equal(JSON.stringify(result).includes('private-sentinel'), false);
  }
});

test('company SDK identity reaches the handler unchanged despite forged event identity', async () => {
  for (const caller of [{ WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted' },
    { APPID: 'wxc94e1c1b38944511', OPENID: 'trusted' }]) {
    const { main, calls } = entry(caller);
    assert.equal((await main({ action: 'getOwnedMedia', OPENID: 'forged' })).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { ...caller, TCB_ENV: 'cloudbase-d2g65rqbvee0bd978' });
  }
});


