const test = require('node:test'), assert = require('node:assert/strict');
const timing = require('../miniprogram/utils/cloud-call');
test('server stages retain only finite nonnegative timing fields and cannot be mutated through snapshots', async () => {
  timing.clear();
  const reported = { sdkLoadMs: 823, initMs: 4, readMs: 1919, accountId: 'private', coordinates: [31, 121] };
  const response = { result: { ok: true, serverTiming: reported } };
  const wx = { cloud: { callFunction: async () => response } };
  const request = { name: 'catalog-read', data: { action: 'listDiscovery' } };
  assert.equal(await timing.call(wx, request), response);
  reported.readMs = 999;
  const snapshot = timing.read();
  assert.deepEqual(snapshot[0].serverTiming, { sdkLoadMs: 823, initMs: 4, readMs: 1919 });
  snapshot[0].serverTiming.readMs = 0;
  assert.equal(timing.read()[0].serverTiming.readMs, 1919);
  assert.equal(JSON.stringify(timing.read()).includes('private'), false);
  for (const invalid of [-1, Infinity, NaN, '123', null, {}]) {
    response.result.serverTiming = { sdkLoadMs: invalid, initMs: invalid, readMs: invalid };
    await timing.call(wx, request);
    assert.equal(Object.hasOwn(timing.read().at(-1), 'serverTiming'), false);
  }
  response.result.serverTiming = { sdkLoadMs: 0, readMs: -1 };
  await timing.call(wx, request);
  assert.deepEqual(timing.read().at(-1).serverTiming, { sdkLoadMs: 0 });
});
test('timing preserves exact request, receiver, response and exceptions without retry', async () => {
  timing.clear();
  const request = { name: 'account-api', data: { action: 'getMine', secret: 'never record' } }, result = { result: { ok: true, data: { private: 'never record' } } };
  let calls = 0;
  const wx = { cloud: { async callFunction(options) { calls++; assert.equal(this, wx.cloud); assert.equal(options, request); return result; } } };
  assert.equal(await timing.call(wx, request), result); assert.equal(calls, 1);
  const error = Error('private'); wx.cloud.callFunction = async () => { calls++; throw error; };
  await assert.rejects(timing.call(wx, request), e => e === error); assert.equal(calls, 2);
  assert.deepEqual(timing.read().map(r => r.ok), [true, false]);
  assert.equal(JSON.stringify(timing.read()).includes('private'), false);
  assert.equal(JSON.stringify(timing.read()).includes('secret'), false);
});
test('bounded samples and logout prevent late completions restoring diagnostics', async () => {
  timing.clear();
  const wx = { cloud: { callFunction: async () => ({ result: { ok: false } }) } };
  for (let i = 0; i < 105; i++) await timing.call(wx, { name: 'catalog-read', data: { action: 'listDiscovery' } });
  assert.equal(timing.read().length, 100);
  let finish; wx.cloud.callFunction = () => new Promise(resolve => { finish = resolve; });
  const pending = timing.call(wx, { name: 'catalog-read', data: {} });
  timing.clear(); finish({ result: { ok: true } }); await pending;
  assert.deepEqual(timing.read(), []);
});

test('active network count survives cache reset and clears after rejection',async()=>{
 let finish;const wx={cloud:{callFunction:()=>new Promise((_,reject)=>{finish=reject;})}};
 const pending=timing.call(wx,{name:'account-api',data:{action:'getMine'}});
 assert.equal(timing.isBusy(),true);timing.clear();assert.equal(timing.isBusy(),true);
 finish(Error('offline'));await assert.rejects(pending,/offline/);assert.equal(timing.isBusy(),false);
});
