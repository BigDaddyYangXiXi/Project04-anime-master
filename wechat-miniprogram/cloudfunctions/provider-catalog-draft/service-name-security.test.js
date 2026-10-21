const test=require('node:test'),assert=require('node:assert/strict');
const {reviewServiceNames}=require('./service-name-security');
test('service name screening batches names once and accepts only an explicit pass',async()=>{
 let calls=0;await reviewServiceNames([{name:'服务甲'},{name:'服务乙'},{name:'服务甲'}],'trusted',async request=>{
  calls++;assert.deepEqual(request,{content:'服务甲\n服务乙',openid:'trusted',scene:2,version:2});return {errcode:0,result:{suggest:'pass'}};
 });assert.equal(calls,1);
 for(const [response,code] of [[{errcode:0,result:{suggest:'risky'}},'SERVICE_NAME_REJECTED'],[{errCode:0,result:{suggest:'review'}},'SERVICE_NAME_REJECTED'],[{errcode:1,result:{suggest:'pass'}},'SERVICE_NAME_CHECK_UNAVAILABLE'],[null,'SERVICE_NAME_CHECK_UNAVAILABLE'],[{errcode:0},'SERVICE_NAME_CHECK_UNAVAILABLE']])
  await assert.rejects(reviewServiceNames([{name:'服务'}],'trusted',async()=>response),{code});
 await assert.rejects(reviewServiceNames([{name:'服务'}],'trusted',async()=>{throw Error('private');}),{code:'SERVICE_NAME_CHECK_UNAVAILABLE',message:'SERVICE_NAME_CHECK_UNAVAILABLE'});
 await assert.rejects(reviewServiceNames([{name:'服务'}],'',async()=>({errcode:0,result:{suggest:'pass'}})),{code:'AUTH_CONTEXT_MISSING'});
});
