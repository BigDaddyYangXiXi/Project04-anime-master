const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { validateFileId } = require('./media-core');
const requestContext = require('./request-context');

test('authenticated media entry supplies the same trusted environment to storage and file validation', async () => {
  const target = {};
  let initializedEnv;
  new Function('require', 'exports', fs.readFileSync(require.resolve('./index'), 'utf8'))(name => {
    if (name === './request-context') return requestContext;
    if (name === '@cloudbase/node-sdk') return { SYMBOL_CURRENT_ENV: Symbol('current'), init(config) {
      initializedEnv = config.env; return { rdb: () => ({}) };
    } };
    if (name === './media-core') return { async handleMediaUpload(db, app, event, caller) {
      assert.equal(caller.WX_OPENID, 'trusted-user');
      assert.equal(caller.TCB_ENV, initializedEnv);
      assert.equal(caller.TCB_ENV, 'cloudbase-d2g65rqbvee0bd978');
      return { fileId: validateFileId('cloud://cloudbase-d2g65rqbvee0bd978.bucket/image.png', 'image.png', caller.TCB_ENV) };
    } };
    throw Error('Unexpected module');
  }, target);
  const result = await target.main({ TCB_ENV: 'attacker-env' }, {
    environment: JSON.stringify({ WX_OPENID: 'trusted-user', WX_APPID: 'wxc94e1c1b38944511', TCB_ENV: 'ignored' })
  });
  assert.equal(result.ok, true);
});
