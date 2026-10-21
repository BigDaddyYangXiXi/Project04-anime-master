const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function entry(env={},caller={WX_OPENID:'server_openid',WX_APPID:'test_app'},failure,workerResult) {
  const records={logs:[],calls:0};
  const sandbox={exports:{},process:{env},Map,Buffer,console:{error:value=>records.logs.push(value)},require(name) {
    if (name === 'node:crypto') return require('node:crypto');
    if (name === './payment-worker') return require('./payment-worker');
    if (name === './payment-reconcile') return {reconcilePayments:async(pool,config)=>{
      records.calls++;records.config=config;return {enabled:true,examined:0,failed:0};
    }};
    if (name === './refund-operator') return require('./refund-operator');
    if (name === './refund-reconcile') return {reconcileRefunds:async(pool,config)=>{
      records.calls++;records.config=config;if(failure)throw failure;return workerResult || {enabled:config.refundReconciliationEnabled===true,examined:0,failed:0};
    }};
    if (name === './request-context') return () => caller;
    if (name === './tax-submission-handler') return { submitOwnTaxProfile: async (pool,event,actor,config) => {
      records.calls++;records.actor=actor;records.event=event;
      if(failure)throw failure;return {status:'SUBMITTED',verified:false};
    }};
    if (name === './tax-status-read') return { readTaxProfileStatus: async (pool,event,actor,config) => {
      records.calls++;records.actor=actor;records.event=event;
      if(failure)throw failure;return {status:'NOT_SUBMITTED'};
    }};
    if (name === './refund-read') return { listOrderRefunds: async (pool,event,actor,config) => {
      records.calls++;records.actor=actor;records.event=event;records.config=config;
      if(failure)throw failure;return {records:[],nextCursor:null};
    }, readRefundRequest: async (pool,event,actor,config) => {
      records.calls++;records.actor=actor;records.event=event;records.config=config;
      if(failure)throw failure;return {status:'SUCCESS'};
    }};
    if (name === './refund-request') return { createRefundRequest: async (pool,event,actor,config) => {
      records.calls++;records.actor=actor;records.event=event;records.config=config;
      if(failure)throw failure;return {status:'REQUESTED'};
    }};
    if(name==='@cloudbase/node-sdk')return {getCloudbaseContext:()=>caller};
    if(name==='mysql2/promise')return {createPool:options=>{records.pool=options;return {};}};
    if(name==='./payment-http')return {handlePaymentHttp:async(pool,event,config)=>{
      records.http={pool,event,config};
      if(event?.httpMethod!=='POST')return {statusCode:405};
      if(failure)throw failure;
      return {statusCode:204,body:''};
    }};
    if(name==='./payment-refresh')return {refreshPayment:async(pool,event,actor)=>{
      records.calls++;records.actor=actor;records.event=event; if(failure)throw failure;return {queryStatus:'QUERIED'};
    }};
    if(name==='./payment-create')return {createPayment:async(pool,event,actor,config)=>{
      records.calls++;records.actor=actor;records.event=event;records.config=config;records.action='createPayment';
      if(failure)throw failure;return {status:'READY',paymentRequest:{package:'prepay_id=test_only'}};
    }};
    throw new Error('unexpected dependency');
  }};
  vm.runInNewContext(fs.readFileSync(`${__dirname}/index.js`,'utf8'),sandbox);
  return {main:sandbox.exports.main,notify:sandbox.exports.notify,paymentReconcile:sandbox.exports.paymentReconcile,refundReconcile:sandbox.exports.refundReconcile,refundOperator:sandbox.exports.refundOperator,records};
}
const env={PAYMENT_MYSQL_CONFIG:JSON.stringify({host:'db.example.test',database:'orders',user:'reader',password:'test-only'}),
  PAYMENT_WECHAT_CONFIG:JSON.stringify({appid:'test_app',publicKeys:{}})};
test('tax status dispatch uses signed identity and redacts query failures',async()=>{
  const api=entry(env);
  assert.equal((await api.main({action:'getTaxProfileStatus',userInfo:{openId:'forged'}},{})).data.status,'NOT_SUBMITTED');
  assert.equal(api.records.actor.WX_OPENID,'server_openid');
  assert.equal(api.records.event.userInfo,undefined);
  const broken=entry(env,undefined,Error('private certificate data'));
  const result=await broken.main({action:'getTaxProfileStatus'},{});
  assert.equal(result.error.code,'TAX_STATUS_READ_FAILED');
  assert.doesNotMatch(JSON.stringify([result,broken.records.logs]),/private certificate/);
});
test('tax submission dispatch strips platform metadata and never leaks raw identity errors',async()=>{
  const api=entry(env);
  const result=await api.main({action:'submitTaxProfile',userInfo:{openId:'forged'},documentNumber:'fixture-private'},{});
  assert.equal(result.data.status,'SUBMITTED'); assert.equal(result.data.verified,false);
  assert.equal(api.records.actor.WX_OPENID,'server_openid'); assert.equal(api.records.event.userInfo,undefined);
  const failed=entry(env,undefined,Error('fixture-private'));
  const error=await failed.main({action:'submitTaxProfile'},{});
  assert.equal(error.error.code,'TAX_SUBMISSION_FAILED');
  assert.doesNotMatch(JSON.stringify([error,failed.records.logs]),/fixture-private/);
});

test('payment query worker is wired to private entry only and preserves query-only configuration',async()=>{
  const token='d'.repeat(64),api=entry({...env,SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_QUERY_WORKER_TOKEN:token,
    PAYMENT_WECHAT_CONFIG:JSON.stringify({appid:'test_app',closeEnabled:false,reconciliationEnabled:true,publicKeys:{}})},{});
  assert.equal((await api.main({action:'paymentReconcile',workerToken:token},{})).ok,false);
  assert.equal(api.records.pool,undefined);
  assert.equal((await api.paymentReconcile({workerToken:token},{})).ok,true);
  assert.equal(api.records.calls,1);assert.equal(api.records.config.closeEnabled,false);
});

test('refund operator entry trusts SDK caller and is never dispatched through public RPC',async()=>{
  const token='a'.repeat(64),api=entry({...env,SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',
    PAYMENT_REFUND_OPERATOR_TOKEN:token,PAYMENT_REFUND_REVIEWER_ID:'operator_1'});
  const request={action:'review',operatorToken:token,refundId:'b'.repeat(32),decision:'APPROVE',evidenceReference:'case_1',userInfo:{}};
  assert.equal((await api.refundOperator(request,{})).error.code,'REFUND_OPERATOR_FORBIDDEN');
  for(const action of ['refundOperator','review','execute']) assert.equal((await api.main({...request,action},{})).ok,false);
  assert.equal(api.records.pool,undefined);
});

test('internal refund worker requires company namespace, secret and non-WeChat caller before allocating database',async()=>{
  const token='a'.repeat(64),workerEnv={...env,SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_REFUND_WORKER_TOKEN:token};
  for(const [configuration,caller,event] of [[workerEnv,{},{}],[workerEnv,{}, {workerToken:'b'.repeat(64)}],
    [workerEnv,{WX_OPENID:'mini_user'},{workerToken:token}],[workerEnv,{OPENID:'mini_user'},{workerToken:token}],
    [{...workerEnv,SCF_NAMESPACE:'other'}, {},{workerToken:token}],[workerEnv,{}, {workerToken:token,refundEnabled:true}]]) {
    const api=entry(configuration,caller);assert.equal((await api.refundReconcile(event,{})).error.code,'REFUND_WORKER_FORBIDDEN');
    assert.equal(api.records.pool,undefined);assert.equal(api.records.calls,0);
  }
  const allowed=entry(workerEnv,{});assert.equal((await allowed.refundReconcile({workerToken:token},{})).ok,true);
  assert.equal(allowed.records.calls,1);assert.equal(allowed.records.config.refundEnabled,undefined);
  assert.equal((await allowed.main({action:'refundReconcile',workerToken:token},{})).ok,false);
});

test('refund worker failures never return or log credentials or raw database errors',async()=>{
  const token='c'.repeat(64),secret='private database detail';
  const api=entry({...env,SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_REFUND_WORKER_TOKEN:token},{},Error(secret));
  const result=await api.refundReconcile({workerToken:token},{});
  assert.equal(result.error.code,'REFUND_WORKER_FAILED');assert.doesNotMatch(JSON.stringify([result,api.records.logs]),new RegExp(secret+'|'+token));
});

test('timer envelope retains secret and caller checks instead of trusting Type Timer',async()=>{
  const token='d'.repeat(64),workerEnv={...env,PAYMENT_WECHAT_CONFIG:JSON.stringify({...JSON.parse(env.PAYMENT_WECHAT_CONFIG),refundReconciliationEnabled:true}),SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_REFUND_WORKER_TOKEN:token};
  const timer={Type:'Timer',TriggerName:'refund-reconcile-every-five-minutes',Time:'2026-09-25T00:00:00Z',Message:JSON.stringify({workerToken:token})};
  const allowed=entry(workerEnv,{});assert.equal((await allowed.refundReconcile(timer,{})).ok,true);assert.equal(allowed.records.calls,1);
  for(const patch of [{TriggerName:'other'},{Time:'invalid'},{Message:'invalid'},{Message:'null'},
    {Message:JSON.stringify({workerToken:'e'.repeat(64)})},{Message:JSON.stringify({workerToken:token,refundEnabled:true})},{workerToken:token}]){
    const api=entry(workerEnv,{});await assert.rejects(api.refundReconcile({...timer,...patch},{}),/REFUND_WORKER_SCHEDULE_FAILED/);assert.equal(api.records.pool,undefined);
  }
  const client=entry(workerEnv,{WX_OPENID:'user'});await assert.rejects(client.refundReconcile(timer,{}),/REFUND_WORKER_SCHEDULE_FAILED/);
});

test('scheduled database errors, partial failures and disabled scans fail monitoring without exposing secrets',async()=>{
  const token='f'.repeat(64),workerEnv={...env,SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_REFUND_WORKER_TOKEN:token};
  const timer={Type:'Timer',TriggerName:'refund-reconcile-every-five-minutes',Time:'2026-09-25T00:00:00Z',Message:JSON.stringify({workerToken:token})};
  for(const [failure,result] of [[Error('private database detail'),undefined],[undefined,{enabled:true,examined:2,queried:1,failed:1}],[undefined,{enabled:false}]]) {
    const api=entry(workerEnv,{},failure,result);
    await assert.rejects(api.refundReconcile(timer,{}),error=>{
      assert.equal(error.message,'REFUND_WORKER_SCHEDULE_FAILED');
      assert.doesNotMatch(String(error.stack)+JSON.stringify(api.records.logs),/private database detail|ffffffff/);return true;
    });
  }
});
test('encoded deployment configuration preserves values and rejects ambiguous or broken configuration',async()=>{
  const encoded=Object.fromEntries(Object.entries(env).map(([key,value])=>[`${key}_B64`,Buffer.from(value).toString('base64')]));
  const allowed=entry(encoded);
  assert.equal((await allowed.main({action:'refreshPayment'},{})).ok,true);
  assert.equal(allowed.records.pool.host,'db.example.test');
  assert.equal(allowed.records.pool.password,'test-only');
  for(const key of Object.keys(env)) {
    for(const configuration of [{...encoded,[key]:env[key]}, {...encoded,[`${key}_B64`]:'invalid-json'}]) {
      const denied=entry(configuration);
      assert.equal((await denied.main({action:'refreshPayment'},{})).error.code,'PAYMENT_QUERY_NOT_CONFIGURED');
      assert.equal(denied.records.pool,undefined);
      assert.equal(denied.records.calls,0);
    }
  }
});
test('notification entry passes original HTTP payload to signed handler without trusting RPC identity',async()=>{
  const {notify,records}=entry(env,{});
  const event={httpMethod:'POST',body:' {"signed":"original bytes"}\n',headers:{'Wechatpay-Signature':'signature'}};
  assert.equal((await notify(event)).statusCode,204);
  assert.equal(records.http.event,event);
  assert.equal(records.http.config.appid,'test_app');
  assert.equal(records.calls,0);
});
test('notification rejects non-POST before allocating database and never acknowledges setup failures',async()=>{
  const absent=entry();
  assert.equal((await absent.notify({httpMethod:'GET'})).statusCode,405);
  assert.equal(absent.records.pool,undefined);
  assert.equal((await absent.notify({httpMethod:'POST'})).statusCode,503);
  assert.equal(absent.records.pool,undefined);
  const broken=entry(env,{},Error('secret-database-details'));
  const result=await broken.notify({httpMethod:'POST'});
  assert.equal(result.statusCode,503);
  assert.doesNotMatch(JSON.stringify({result,logs:broken.records.logs}),/secret-database-details/);
});
test('private database exception requires explicit company environment and exact target',async()=>{
  const database={transport:'company-vpc',host:'172.17.0.13',port:3306,database:'cloudbase-d2g65rqbvee0bd978',user:'am_payment',password:'test-only'};
  const environment={...env,SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_MYSQL_CONFIG:JSON.stringify(database)};
  const allowed=entry(environment);
  assert.equal((await allowed.main({action:'refreshPayment'},{})).ok,true);
  assert.equal(allowed.records.pool.ssl,undefined);
  for(const changed of [{host:'db.example.test'},{host:'172.17.0.14'},{port:3307},{database:'other'},{user:'root'},{transport:'plain'}]) {
    const blocked=entry({...environment,PAYMENT_MYSQL_CONFIG:JSON.stringify({...database,...changed})});
    assert.equal((await blocked.main({action:'refreshPayment'},{})).error.code,'PAYMENT_QUERY_NOT_CONFIGURED');
    assert.equal(blocked.records.pool,undefined);
  }
  for(const namespace of [undefined,'another-env']) {
    const blocked=entry({...environment,SCF_NAMESPACE:namespace});
    assert.equal((await blocked.main({action:'refreshPayment'},{})).error.code,'PAYMENT_QUERY_NOT_CONFIGURED');
    assert.equal(blocked.records.pool,undefined);
  }
});
test('missing production configuration never creates a database connection',async()=>{
  const {main,records}=entry();const result=await main({action:'refreshPayment',orderId:'order_1'},{});
  assert.equal(result.error.code,'PAYMENT_QUERY_NOT_CONFIGURED');assert.equal(records.pool,undefined);assert.equal(records.calls,0);
});
test('runtime uses SDK identity and strict database TLS instead of client identity/configuration',async()=>{
  const {main,records}=entry(env);
  const result=await main({action:'refreshPayment',orderId:'order_1',WX_OPENID:'forged'},{});
  assert.equal(result.ok,true);assert.equal(records.actor.WX_OPENID,'server_openid');
  assert.equal(records.pool.ssl.rejectUnauthorized,true);assert.equal(records.pool.ssl.verifyIdentity,true);
  assert.equal(records.pool.ssl.minVersion,'TLSv1.2');
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

test('create dispatch uses trusted identity and does not enable payment from client input',async()=>{
  const {main,records}=entry(env);
  const result=await main({action:'createPayment',orderId:'order_1',prepayEnabled:true},{});
  assert.equal(result.data.status,'READY');assert.equal(records.action,'createPayment');
  assert.equal(records.actor.WX_OPENID,'server_openid');
  assert.equal(records.config.prepayEnabled,undefined);
});

test('unknown public actions cannot allocate a database pool',async()=>{
  const {main,records}=entry(env);
  for(const event of [null,{}, {action:'settlePayment'}]) {
    assert.equal((await main(event,{})).error.code,'PAYMENT_INPUT_INVALID');
  }
  assert.equal(records.pool,undefined);assert.equal(records.calls,0);
});

test('refund RPC uses trusted identity, strips platform metadata and redacts internal failures',async()=>{
  const {main,records}=entry(env);
  const result=await main({action:'requestRefund',userInfo:{openId:'forged'},tcbContext:{},status:'APPROVED'},{});
  assert.equal(result.data.status,'REQUESTED');assert.equal(records.actor.WX_OPENID,'server_openid');
  assert.equal(records.event.userInfo,undefined);assert.equal(records.event.tcbContext,undefined);
  assert.equal(records.event.status,'APPROVED'); // The domain validator must see and reject forbidden fields.
  const broken=entry(env,undefined,{code:'PRIVATE_SQL',message:'secret-detail'});
  assert.equal((await broken.main({action:'requestRefund'},{})).error.code,'REFUND_REQUEST_FAILED');
  assert.doesNotMatch(JSON.stringify(broken.records.logs),/PRIVATE_SQL|secret-detail/);
});

test('refund read dispatch keeps trusted identity and distinguishes read failure from submission failure',async()=>{
  const {main,records}=entry(env);
  const result=await main({action:'getRefund',refundId:'a'.repeat(32),userInfo:{openId:'forged'}},{});
  assert.equal(result.data.status,'SUCCESS');assert.equal(records.actor.WX_OPENID,'server_openid');
  assert.equal(records.event.userInfo,undefined);
  const broken=entry(env,undefined,{code:'PRIVATE_SQL',message:'secret-detail'});
  assert.equal((await broken.main({action:'getRefund'},{})).error.code,'REFUND_READ_FAILED');
  assert.doesNotMatch(JSON.stringify(broken.records.logs),/PRIVATE_SQL|secret-detail/);
  assert.equal((await main({action:'listRefunds',orderId:'order_1'},{})).data.records.length,0);
  assert.equal((await broken.main({action:'listRefunds'},{})).error.code,'REFUND_READ_FAILED');
});

test('create failures distinguish closed product and redact internal details',async()=>{
  for(const code of ['PAYMENT_PREPAY_NOT_ENABLED','PRIVATE_SQL']) {
    const {main,records}=entry(env,undefined,{code,message:'private-db-detail'});
    const result=await main({action:'createPayment'},{});
    assert.equal(result.error.code,code==='PRIVATE_SQL'?'PAYMENT_CREATE_FAILED':code);
    assert.doesNotMatch(JSON.stringify({result,logs:records.logs}),/PRIVATE_SQL|private-db-detail/);
  }
});

test('platform metadata is stripped for both actions without trusting its identity or dropping forbidden overrides',async()=>{
  for(const action of ['createPayment','refreshPayment']) {
    const {main,records}=entry(env);
    await main({action,orderId:'order_1',userInfo:{openId:'forged',appId:'foreign'},tcbContext:{WX_OPENID:'forged'},amountFen:1},{});
    assert.equal(Object.hasOwn(records.event,'userInfo'),false);
    assert.equal(Object.hasOwn(records.event,'tcbContext'),false);
    assert.equal(records.event.amountFen,1);
    assert.equal(records.actor.WX_OPENID,'server_openid');
    const missing=entry(env,{});
    assert.equal((await missing.main({action,userInfo:{openId:'forged',appId:'test_app'},tcbContext:{WX_OPENID:'forged',WX_APPID:'test_app'}},{})).error.code,'AUTH_CONTEXT_MISSING');
    assert.equal(missing.records.calls,0);
  }
});
