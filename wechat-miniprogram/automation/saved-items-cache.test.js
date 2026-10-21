const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  let now = 1000, invalidations = 0;
  const app = { globalData: { account: { id: 'one' } } }, calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/services/cloud-saved-items'), 'utf8'), {
    module, getApp: () => app, Date: { now: () => now }, wx: { cloud: { callFunction() {} } },
    require: name => name.includes('cloud-call') ? { call: (_, options) => new Promise((resolve, reject) => calls.push({ action: options.data.action, resolve: data => resolve({ result: { ok: true, data } }), reject })) }
      : name.includes('display-cache') ? { clear: () => invalidations++ }
      : name.includes('local-preview') ? { assertCloudAllowed() {} } : { enabled: true, env: 'test' }
  });
  return { api: module.exports, app, calls, advance: ms => { now += ms; }, invalidations: () => invalidations };
}
const saved = { providerIds: ['author'], workIds: ['work'], receivedWorkLikes: 2 };

test('saved items coalesce across pages, isolate returned arrays and expire after fifteen minutes', async () => {
  const f = fixture(), first = f.api.listMine(), second = f.api.listMine();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve(saved);
  const [a, b] = await Promise.all([first, second]);
  a.workIds.push('local'); assert.equal(b.workIds.length, 1);
  f.advance(31000);
  assert.equal((await f.api.listMine()).workIds.length, 1); assert.equal(f.calls.length, 1);
  f.advance(869000);
  const expired = f.api.listMine(); assert.equal(f.calls.length, 2);
  f.calls[1].resolve(saved); await expired;
});

test('mutations invalidate stats and late reads; failure retries and logout or switch cannot reuse old cache', async () => {
  const f = fixture(), old = f.api.listMine();
  const write = f.api.setSaved('WORK', 'work', false);
  f.calls[1].resolve({ saved: false }); await write;
  assert.equal(f.invalidations(), 1);
  f.calls[0].resolve(saved); await old;
  const fresh = f.api.listMine(); assert.equal(f.calls.length, 3);
  f.calls[2].resolve({ ...saved, workIds: [] }); await fresh;
  assert.equal((await f.api.listMine()).workIds.length, 0);
  f.app.globalData.account = { id: 'two' };
  const other = f.api.listMine(); assert.equal(f.calls.length, 4);
  f.calls[3].reject(Error('offline')); await assert.rejects(other, /offline/);
  const retry = f.api.listMine(); f.calls[4].resolve(saved); await retry;
  f.api.clearCache();
  const logoutRead = f.api.listMine(); assert.equal(f.calls.length, 6);
  f.calls[5].resolve(saved); await logoutRead;
  const failedWrite = f.api.setSaved('WORK', 'work', true);
  f.calls[6].reject(Error('unknown outcome')); await assert.rejects(failedWrite);
  const recheck = f.api.listMine(); assert.equal(f.calls.length, 8);
  f.calls[7].resolve(saved); await recheck;
});
