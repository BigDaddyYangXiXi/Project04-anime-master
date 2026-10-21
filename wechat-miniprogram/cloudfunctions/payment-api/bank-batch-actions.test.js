const test=require('node:test'),assert=require('node:assert/strict');
const {operateBankBatch,validBankBatchEvent}=require('./bank-batch-actions');
const {operateRefund}=require('./refund-operator');
const {queryEvent}=require('../../scripts/refund-operator-console');
const id='a'.repeat(32),token='b'.repeat(64),reserve={action:'bankReserve',requestKey:'bank_request_0001',paymentIds:[id]};
const env={SCF_NAMESPACE:'cloudbase-d2g65rqbvee0bd978',PAYMENT_REFUND_OPERATOR_TOKEN:token,PAYMENT_REFUND_REVIEWER_ID:'refund_service',BANK_BATCH_OPERATOR_ID:'finance'};
const forbidden=()=>assert.fail('must not execute');
test('bank operator must be explicitly configured; refund service identity is never a fallback',async()=>{
  for(const bankOperator of [undefined,'','invalid operator',123]) {
    const result=await operateRefund({...reserve,operatorToken:token},{},{...env,BANK_BATCH_OPERATOR_ID:bankOperator},forbidden);
    assert.equal(result.error.code,'BANK_BATCH_OPERATOR_NOT_CONFIGURED');
  }
  const result=await operateRefund({...reserve,operatorToken:token},{},env,()=>({pool:{},config:{refundOperatorEnabled:true}}));
  assert.equal(result.error.code,'BANK_BATCH_DISABLED');
});
test('batch private actions deny public callers, absent credentials and injected operator before runtime',async()=>{
  for(const action of ['bankReserve','bankCancel','bankReview','bankFind']){
    assert.equal((await operateRefund({action,operatorToken:token},{WX_OPENID:'user'},env,forbidden)).error.code,'REFUND_OPERATOR_FORBIDDEN');
    assert.equal((await operateRefund({action},{},env,forbidden)).error.code,'REFUND_OPERATOR_FORBIDDEN');
  }
  assert.equal((await operateRefund({...reserve,operatorToken:token,operatorId:'fake'},{},env,forbidden)).error.code,'BANK_BATCH_INPUT_INVALID');
});

test('lost response lookup is company-scoped, read-only and never recreates cancelled or absent batches',async()=>{
  const {findBankBatch}=require('./bank-settlement-store');
  const config={appid:'wx',platformMchid:'merchant',refundOperatorEnabled:true,bankBatchEnabled:true};
  const event={action:'bankFind',requestKey:reserve.requestKey};
  assert.deepEqual(queryEvent(event),event);
  for(const patch of [{requestKey:'short'},{appid:'other'},{operatorId:'fake'},{batchId:id}])
    assert.throws(()=>queryEvent({...event,...patch}),/INVALID_QUERY/);
  for(const batch of [undefined,{id,status:'RESERVED_DRAFT'},{id,status:'CANCELLED'}]) {
    let calls=0;
    const pool={execute:async(sql,args)=>{
      calls++;assert.match(sql,/^SELECT id,status FROM bank_settlement_batches/);
      assert.match(sql,/WHERE appid=\? AND platform_mchid=\? AND request_key=\?/);
      assert.deepEqual(args,['wx','merchant',reserve.requestKey]);return [batch?[batch]:[]];
    }};
    const result=await operateBankBatch(event,'finance',()=>({pool,config}),{
      find:findBankBatch,reserve:forbidden,cancel:forbidden,read:forbidden
    });
    assert.equal(calls,1);
    assert.deepEqual(result,{ok:true,data:batch?{found:true,batchId:id,status:batch.status,payable:false}:{found:false,payable:false}});
  }
  const handlers={find:forbidden};
  assert.equal((await operateBankBatch(event,'finance',()=>({pool:{},config:{...config,bankBatchEnabled:false}}),handlers)).error.code,'BANK_BATCH_DISABLED');
  const failed=await operateBankBatch(event,'finance',()=>({pool:{},config}),{find:async()=>{throw Error('private database detail');}});
  assert.deepEqual(failed,{ok:false,error:{code:'BANK_BATCH_READ_FAILED'}});
  await assert.rejects(findBankBatch({execute:forbidden},'short',config),/BANK_BATCH_INPUT_INVALID/);
});
test('batch actions default off independently of refund review and payment switches',async()=>{
  for(const config of [{},{refundOperatorEnabled:true},{bankBatchEnabled:true},{refundOperatorEnabled:true,refundEnabled:true}])
    assert.equal((await operateBankBatch(reserve,'finance',()=>({pool:{},config}),{reserve:forbidden})).error.code,'BANK_BATCH_DISABLED');
});
test('reservation uses fixed server operator and exposes only draft status',async()=>{
  const result=await operateBankBatch(reserve,'finance',()=>({pool:{},config:{refundOperatorEnabled:true,bankBatchEnabled:true}}),{
    reserve:async(pool,input)=>{assert.deepEqual(input,{requestKey:reserve.requestKey,paymentIds:[id],operatorId:'finance'});
      return {batchId:id,status:'RESERVED_DRAFT',secret:'hidden',payable:true};}
  });
  assert.deepEqual(result,{ok:true,data:{batchId:id,status:'RESERVED_DRAFT',payable:false}});
});
test('query CLI rejects mutations and validates batch review; unknown outcome never leaks raw errors',async()=>{
  assert.throws(()=>queryEvent(reserve));assert.throws(()=>queryEvent({action:'bankCancel',batchId:id,reason:'取消'}));
  assert.deepEqual(queryEvent({action:'bankReview',batchId:id}),{action:'bankReview',batchId:id});
  for(const event of [{...reserve,paymentIds:[id,id]},{...reserve,amountFen:1},{action:'bankCancel',batchId:id,reason:''}])assert.equal(validBankBatchEvent(event),false);
  const result=await operateBankBatch(reserve,'finance',()=>({pool:{},config:{refundOperatorEnabled:true,bankBatchEnabled:true}}),{
    reserve:async()=>{throw Error('password private');}
  });
  assert.deepEqual(result,{ok:false,error:{code:'BANK_BATCH_QUERY_REQUIRED'}});
});
test('cancel and review dispatch only their selected handlers with server scope',async()=>{
  const config={refundOperatorEnabled:true,bankBatchEnabled:true,appid:'wx',platformMchid:'merchant'};
  const runtime=()=>({pool:{},config});
  const cancelled=await operateBankBatch({action:'bankCancel',batchId:id,reason:'取消草稿'},'finance',runtime,{
    reserve:forbidden,read:forbidden,cancel:async(pool,input,scope)=>{
      assert.deepEqual(input,{batchId:id,reason:'取消草稿',operatorId:'finance'});assert.equal(scope,config);
      return {batchId:id,status:'CANCELLED'};
    }
  });
  assert.equal(cancelled.data.status,'CANCELLED');assert.equal(cancelled.data.payable,false);
  const reviewed=await operateBankBatch({action:'bankReview',batchId:id},'finance',runtime,{
    reserve:forbidden,cancel:forbidden,read:async(pool,batchId,scope)=>{
      assert.equal(batchId,id);assert.equal(scope,config);return {batchId,payable:false,records:[]};
    }
  });
  assert.deepEqual(reviewed,{ok:true,data:{batchId:id,payable:false,records:[]}});
});
