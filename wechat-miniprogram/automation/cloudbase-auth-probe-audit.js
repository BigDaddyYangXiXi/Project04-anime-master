const assert = require('node:assert/strict');
const path = require('node:path');
const entry = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../cloudfunctions/auth-probe/index.js');
async function run() {
  const probe = require(entry);
  const context = identity => ({environment:JSON.stringify(identity)});
  for(const caller of [undefined, context({}), context({WX_OPENID:'trusted-openid',WX_APPID:'other-app'})]) {
    const rejected = await probe.main({OPENID:'forged',APPID:'wxc94e1c1b38944511'},caller);
    assert.equal(rejected.ok,false);assert.equal(rejected.error.code,'AUTH_CONTEXT_MISSING');
  }
  const verified = await probe.main({OPENID:'forged'},context({WX_OPENID:'trusted-openid',WX_APPID:'wxc94e1c1b38944511',WX_UNIONID:'trusted-unionid'}));
  assert.deepEqual(verified,{ok:true,data:{authenticated:true,appId:'wxc94e1c1b38944511',hasUnionId:true}});
  assert.equal(JSON.stringify(verified).includes('trusted-openid'),false);
  assert.equal(JSON.stringify(verified).includes('trusted-unionid'),false);
  assert.equal((await probe.main({},context({}))).error.code,'AUTH_CONTEXT_MISSING');
  console.log('Auth probe: current invocation identity, foreign app, privacy and sequential rejection passed.');
}
run().catch(()=>{console.error('AUTH_PROBE_AUDIT_FAILED');process.exitCode=1;});
