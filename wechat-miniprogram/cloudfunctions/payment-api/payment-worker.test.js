const test=require('node:test'),assert=require('node:assert/strict');
const {runPaymentWorker}=require('./payment-worker');
const token='a'.repeat(64),env={SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_QUERY_WORKER_TOKEN:token};
const request={workerToken:token};
const timer={Type:'Timer',TriggerName:'payment-reconcile-every-five-minutes',Time:'2026-09-25T00:00:00Z',Message:JSON.stringify(request)};
function fixture(config={closeEnabled:false}){
 const calls=[];
 return {calls,run:(event=request,context={},environment=env)=>runPaymentWorker(event,context,environment,
  ()=>{calls.push('runtime');return {pool:{},config};},async()=>{calls.push('query');return {enabled:true,examined:0,queried:0,skipped:0,failed:0};})};
}
test('requires independent internal credential and company namespace before database initialization',async()=>{
 for(const [event,context,environment] of [[{}, {},env],[{workerToken:'b'.repeat(64)},{},env],[{...request,orderId:'injected'},{},env],
  [request,{environment:JSON.stringify({OPENID:'user'})},env],[request,{environ:'WX_OPENID=user'},env],[request,{}, {...env,SCF_NAMESPACE:'other'}],[request,{}, {...env,PAYMENT_QUERY_WORKER_TOKEN:undefined}]]){
  const f=fixture();assert.equal((await f.run(event,context,environment)).error.code,'PAYMENT_WORKER_FORBIDDEN');assert.deepEqual(f.calls,[]);
 }
});
test('manual and timer invocations query once',async()=>{
 for(const event of [request,timer]){const f=fixture();assert.equal((await f.run(event)).ok,true);assert.deepEqual(f.calls,['runtime','query']);}
});
test('rejects close-capable or ambiguous configurations without querying',async()=>{
 for(const config of [{closeEnabled:true},{}]){const f=fixture(config);assert.equal((await f.run()).error.code,'PAYMENT_WORKER_QUERY_ONLY_REQUIRED');assert.deepEqual(f.calls,['runtime']);}
});
test('timer does not replace authentication and rejects malformed envelopes',async()=>{
 for(const patch of [{TriggerName:'refund-reconcile-every-five-minutes'},{Time:'invalid'},{Message:'{}'},{Message:'invalid'}, {extra:true}]){
  const f=fixture();await assert.rejects(f.run({...timer,...patch}),/PAYMENT_WORKER_SCHEDULE_FAILED/);assert.deepEqual(f.calls,[]);
 }
});
test('scheduled disabled and failed batches are visible failures; exceptions are redacted',async()=>{
 for(const result of [{enabled:false},{enabled:true,failed:1}]){
  await assert.rejects(runPaymentWorker(timer,{},env,()=>({pool:{},config:{closeEnabled:false}}),async()=>result),/PAYMENT_WORKER_SCHEDULE_FAILED/);
 }
 const fail=()=>{throw Error('sensitive database credentials');};
 assert.deepEqual(await runPaymentWorker(request,{},env,fail,fail),{ok:false,error:{code:'PAYMENT_WORKER_FAILED'}});
 await assert.rejects(runPaymentWorker(timer,{},env,fail,fail),error=>error.message==='PAYMENT_WORKER_SCHEDULE_FAILED');
});
