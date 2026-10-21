const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const services = {
  'project-api': ['listProjects', 'getProject', 'createProject', 'saveProject', 'linkOrder', 'unlinkOrder', 'getTargetImages'],
  'saved-items-api': ['listMine', 'setSaved'],
  'availability-api': ['getMine', 'saveMine'],
  'provider-catalog-draft': ['getDraft', 'saveDraft', 'publishDraft', 'getQualification', 'submitQualification']
};
function entry(name, caller) {
  const calls = [];
  const handler = async (db, event, identity) => { calls.push(identity); return {}; };
  const sandbox = { exports: {}, console: { error() {} }, require(dependency) {
    if (dependency === '@cloudbase/node-sdk') return { getCloudbaseContext: () => caller,
      init: () => { calls.push('init'); return { rdb: () => ({}) }; } };
    const modules = {
      './project-core': { handleProject: handler }, './saved-items-core': { handleSavedItems: handler },
      './availability-core': { handleAvailability: handler }, './draft-core': { handleProviderDraft: handler },
      './publication-core': { handleProviderPublish: handler }, './qualification-core': { handleQualification: handler }
    };
    if (dependency === './request-context') return require(path.resolve(__dirname, '../cloudfunctions', name, 'request-context'));
    if (modules[dependency]) return modules[dependency];
    throw Error('unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../cloudfunctions', name, 'index.js'), 'utf8'), sandbox);
  return { main: (event, context = {environment:JSON.stringify(caller)}) => sandbox.exports.main(event, context), calls };
}
for (const [name, actions] of Object.entries(services)) {
  test(`${name}: private actions reject untrusted company identity before database access`, async () => {
    for (const caller of [{}, { WX_APPID: 'other', WX_OPENID: 'trusted' },
      { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: {} }, { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: ' ' }]) {
      for (const action of actions) {
        const { main, calls } = entry(name, caller);
        const result = await main({ action, APPID: 'wxc94e1c1b38944511', OPENID: 'forged', userInfo: { openId: 'forged' } });
        assert.equal(result.error?.code, 'AUTH_CONTEXT_MISSING'); assert.deepEqual(calls, []);
      }
    }
  });
  test(`${name}: original company identity reaches each handler`, async () => {
    for (const action of actions) {
      const caller = { WX_APPID: 'wxc94e1c1b38944511', WX_OPENID: 'trusted' };
      const { main, calls } = entry(name, caller);
      assert.equal((await main({ action, OPENID: 'forged' })).ok, true); assert.deepEqual(calls[1], caller);
    }
  });
}
test('public availability keeps its existing anonymous read contract', async () => {
  const { main, calls } = entry('availability-api', {});
  assert.equal((await main({ action: 'getPublic', providerId: 'public-provider' })).ok, true);
  assert.equal(calls[0], 'init');
});


test('a stale SDK identity cannot replace a missing current invocation identity',async()=>{
 for(const name of Object.keys(services)){
  const f=entry(name,{WX_APPID:'wxc94e1c1b38944511',WX_OPENID:'previous-user'});
  const result=await f.main({action:services[name][0],OPENID:'forged'},{});
  assert.equal(result.error.code,'AUTH_CONTEXT_MISSING');assert.deepEqual(f.calls,[]);
 }
});
