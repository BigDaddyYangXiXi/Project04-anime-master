const test=require('node:test'),assert=require('node:assert/strict');
const {main}=require('./index');
test('support entry rejects missing, wrong-app and event-forged identities',async()=>{
 for(const context of [{},{environment:JSON.stringify({WX_APPID:'wrong',WX_OPENID:'user'})},{environment:JSON.stringify({WX_APPID:'wxc94e1c1b38944511'})}]){
  const result=await main({action:'list',WX_APPID:'wxc94e1c1b38944511',WX_OPENID:'forged',accountId:'forged'},context);
  assert.equal(result.ok,false);assert.equal(result.error.code,'AUTH_CONTEXT_MISSING');
 }
});
