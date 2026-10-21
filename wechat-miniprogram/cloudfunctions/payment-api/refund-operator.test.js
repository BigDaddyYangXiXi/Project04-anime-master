const test = require('node:test');
const assert = require('node:assert/strict');
const {operateRefund} = require('./refund-operator');
const token = 'a'.repeat(64), id = 'b'.repeat(32);
const env = {SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_REFUND_OPERATOR_TOKEN:token,PAYMENT_REFUND_REVIEWER_ID:'operator_1'};
const request = {operatorToken:token,action:'review',refundId:id,decision:'APPROVE',evidenceReference:'case_1'};
const config = {refundOperatorEnabled:true,refundReviewEnabled:true,refundEnabled:false};
const forbidden = () => assert.fail('must not allocate database or invoke a handler');

test('abnormal receipt query uses existing operator gate and rejects filter injection',async()=>{
  const input={operatorToken:token,action:'paymentReviews'};
  for(const patch of [{appid:'other'},{status:'PAID'},{cursor:{paidAt:-1,id}}]) {
    assert.equal((await operateRefund({...input,...patch},{},env,forbidden,{})).error.code,'REFUND_OPERATOR_INPUT_INVALID');
  }
  const response=await operateRefund(input,{},env,()=>({pool:{},config:{refundOperatorEnabled:true}}),{
    paymentReviews:async()=>({records:[],nextCursor:null}),read:forbidden,review:forbidden,execute:forbidden});
  assert.equal(response.ok,true);
  assert.equal((await operateRefund(input,{WX_OPENID:'buyer'},env,forbidden,{})).error.code,'REFUND_OPERATOR_FORBIDDEN');
});

test('operator list validates status and binds cursor to filter before runtime',async()=>{
  const input={operatorToken:token,action:'list',status:'REQUESTED'};
  for(const patch of [{status:'ANY'},{refundId:id},{cursor:{createdAt:1,id,status:'APPROVED'}},
    {cursor:{createdAt:-1,id,status:'REQUESTED'}},{cursor:{createdAt:1,id,status:'REQUESTED',extra:true}}]) {
    const result=await operateRefund({...input,...patch},{},env,forbidden,{});
    assert.equal(result.error.code,'REFUND_OPERATOR_INPUT_INVALID');
  }
  const result=await operateRefund(input,{},env,()=>({pool:{},config:{refundOperatorEnabled:true}}),
    {read:forbidden,review:forbidden,execute:forbidden,list:async(pool,filter)=>{
      assert.equal(filter.status,'REQUESTED');return {records:[],nextCursor:null};
    }});
  assert.deepEqual(result,{ok:true,data:{records:[],nextCursor:null}});
});

test('operator authentication denies public callers and missing, wrong or worker credentials before runtime',async()=>{
  for (const [input,caller,settings] of [[{}, {},env],[{...request,operatorToken:'c'.repeat(64)},{},env],
    [request,{WX_OPENID:'buyer'},env],[request,{OPENID:'buyer'},env],
    [request,{}, {...env,SCF_NAMESPACE:'other'}],[request,{}, {...env,PAYMENT_REFUND_OPERATOR_TOKEN:undefined}],
    [request,{}, {...env,PAYMENT_REFUND_REVIEWER_ID:''}],[{...request,operatorToken:123},{},env]]) {
    const result = await operateRefund(input,caller,settings,forbidden,{});
    assert.equal(result.error.code,'REFUND_OPERATOR_FORBIDDEN');
  }
});

test('operator rejects injected reviewer, configuration, money and unsupported actions before runtime',async()=>{
  for (const patch of [{reviewerId:'attacker'},{refundEnabled:true},{amountFen:1},{action:'createRefund'},
    {refundId:'invalid'},{decision:'accept'},{evidenceReference:''},{evidenceReference:'x'.repeat(256)}]) {
    const result = await operateRefund({...request,...patch},{},env,forbidden,{});
    assert.equal(result.error.code,'REFUND_OPERATOR_INPUT_INVALID');
  }
});

test('operator and individual action switches default closed',async()=>{
  for (const [action,settings] of [['review',{}],['review',{refundOperatorEnabled:true}],
    ['execute',config],['execute',{refundEnabled:true}]]) {
    const input = action === 'review' ? request : {operatorToken:token,action,refundId:id};
    const result = await operateRefund(input,{},env,()=>({pool:{},config:settings}),{review:forbidden,execute:forbidden});
    assert.equal(result.error.code,'REFUND_OPERATOR_DISABLED');
  }
});

test('review uses fixed reviewer and returns only status; approval never invokes execution',async()=>{
  let calls = 0;
  const result = await operateRefund(request,{},env,()=>({pool:{},config}),{review:async(pool,input)=>{
    calls++;assert.deepEqual(input,{refundId:id,reviewerId:'operator_1',decision:'APPROVE',evidenceReference:'case_1'});
    return {status:'APPROVED',reason:'private',transaction_id:'private',reviewed_by:'operator_1'};
  },execute:forbidden,read:async()=>({refundId:id})});
  assert.equal(calls,1);assert.deepEqual(result,{ok:true,data:{refundId:id,status:'APPROVED'}});
});

test('execution uses original refund ID and preserves busy/query-required outcomes',async()=>{
  for (const status of ['PROCESSING','BUSY','QUERY_REQUIRED','DEFERRED']) {
    const result = await operateRefund({operatorToken:token,action:'execute',refundId:id},{},env,
      ()=>({pool:{},config:{...config,refundEnabled:true}}),{read:async()=>({refundId:id}),review:forbidden,execute:async(pool,refundId)=>{
        assert.equal(refundId,id);return {status,token:'private lease',refund:{reason:'private'}};
      }});
    assert.deepEqual(result,{ok:true,data:{refundId:id,status}});
  }
});

test('unknown execution outcome and review failures are redacted and require original-record recovery',async()=>{
  for (const action of ['review','execute']) {
    const input = action === 'review' ? request : {operatorToken:token,action,refundId:id};
    const fail = async()=>{throw Error('private database detail '+token);};
    const result = await operateRefund(input,{},env,()=>({pool:{},config:{...config,refundEnabled:true}}),{read:async()=>({refundId:id}),review:fail,execute:fail});
    assert.equal(result.error.code,action === 'execute' ? 'REFUND_EXECUTION_QUERY_REQUIRED' : 'REFUND_REVIEW_CHECK_REQUIRED');
    assert.doesNotMatch(JSON.stringify(result),/private|aaaaaaaa/);
  }
});

test('operator reads history with money switches closed and checks scope before any mutation',async()=>{
  const snapshot={refundId:id,status:'REQUESTED',decision:null};
  const result=await operateRefund({operatorToken:token,action:'read',refundId:id},{},env,
    ()=>({pool:{},config:{refundOperatorEnabled:true}}),{read:async()=>snapshot,review:forbidden,execute:forbidden});
  assert.deepEqual(result,{ok:true,data:snapshot});
  for(const action of ['review','execute']) {
    const input=action==='review' ? request : {operatorToken:token,action,refundId:id};
    const denied=await operateRefund(input,{},env,()=>({pool:{},config:{...config,refundEnabled:true}}),
      {read:async()=>{throw Error('REFUND_NOT_FOUND');},review:forbidden,execute:forbidden});
    assert.equal(denied.ok,false);
  }
});

test('fund audit operator action is read-only, scoped by server config and rejects client scope',async()=>{
  const input={operatorToken:token,action:'fundAudit',paymentId:id};
  for(const patch of [{paymentId:'bad'},{appid:'other'},{platformMchid:'other'},{refundId:id}]) {
    assert.equal((await operateRefund({...input,...patch},{},env,forbidden,{})).error.code,'REFUND_OPERATOR_INPUT_INVALID');
  }
  assert.equal((await operateRefund(input,{WX_OPENID:'buyer'},env,forbidden,{})).error.code,'REFUND_OPERATOR_FORBIDDEN');
  const settings={refundOperatorEnabled:true,appid:'app',platformMchid:'merchant'};
  const report={ok:false,paymentId:id,issues:[{code:'REFUND_ALLOCATION_MISMATCH',id}]};
  const response=await operateRefund(input,{},env,()=>({pool:{},config:settings}),{
    fundAudit:async(pool,paymentId,config)=>{assert.equal(paymentId,id);assert.equal(config,settings);return report;},
    review:forbidden,execute:forbidden,read:forbidden});
  assert.deepEqual(response,{ok:true,data:report});
  const failed=await operateRefund(input,{},env,()=>({pool:{},config:settings}),{fundAudit:async()=>{throw Error('private database permission');}});
  assert.equal(failed.error.code,'REFUND_OPERATOR_READ_FAILED');assert.doesNotMatch(JSON.stringify(failed),/private/);
});
