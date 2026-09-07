const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function entry(env={},caller={WX_OPENID:'server_openid',WX_APPID:'test_app'},failure) {
  const records={logs:[],calls:0};
  const sandbox={exports:{},process:{env},Map,console:{error:value=>records.logs.push(value)},require(name){
    if(name==='@cloudbase/node-sdk')return {getCloudbaseContext:()=>caller};
    if(name==='mysql2/promise')return {createPool:options=>{records.pool=options;return {};}};
    if(name==='./payment-refresh')return {refreshPayment:async(pool,event,actor)=>{
      records.calls++;records.actor=actor; if(failure)throw failure;return {queryStatus:'QUERIED'};
    }};
    throw new Error('unexpected dependency');
  }};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`,'utf8'),sandbox);
  return {main:sandbox.exports.main,records};
}
const env={PAYMENT_MYSQL_CONFIG:JSON.stringify({host:'db.example.test',database:'orders',user:'reader',password:'test-only'}),
  PAYMENT_WECHAT_CONFIG:JSON.stringify({appid:'test_app',publicKeys:{}})};
test('missing production configuration never creates a database connection',async()=>{
  const {main,records}=entry();const result=await main({action:'refreshPayment',orderId:'order_1'},{});
  assert.equal(result.error.code,'PAYMENT_QUERY_NOT_CONFIGURED');assert.equal(records.pool,undefined);assert.equal(records.calls,0);
});
test('runtime uses SDK identity and strict database TLS instead of client identity/configuration',async()=>{
  const {main,records}=entry(env);
  const result=await main({action:'refreshPayment',orderId:'order_1',WX_OPENID:'forged'},{});
  assert.equal(result.ok,true);assert.equal(records.actor.WX_OPENID,'server_openid');
  assert.equal(records.pool.ssl.rejectUnauthorized,true);assert.equal(records.pool.ssl.verifyIdentity,true);
  assert.equal(records.pool.multipleStatements,false);
});
test('a different application cannot invoke the query handler',async()=>{
  const {main,records}=entry(env,{WX_OPENID:'server_openid',WX_APPID:'other_app'});
  assert.equal((await main({action:'refreshPayment',orderId:'order_1'},{})).error.code,'AUTH_CONTEXT_MISSING');
  assert.equal(records.calls,0);
});
test('unknown errors are redacted from both response and logs',async()=>{
  const {main,records}=entry(env,undefined,{code:'PRIVATE_SQL',message:'private-db-detail'});
  const result=await main({action:'refreshPayment',orderId:'order_1'},{});
  assert.equal(result.error.code,'PAYMENT_QUERY_FAILED');
  assert.doesNotMatch(JSON.stringify({result,logs:records.logs}),/PRIVATE_SQL|private-db-detail/);
});
