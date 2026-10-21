const test=require('node:test'),assert=require('node:assert/strict');
const {findWithdrawalReceipt}=require('./find-withdrawal-receipt');
test('receipt query rejects absent or coerced identity before reading',async()=>{
  const input={eventId:'a'.repeat(32),requestId:'b'.repeat(32),paymentId:'c'.repeat(32),providerId:'provider'};
  const config={appid:'wx_test',platformMchid:'test_merchant'};
  const pool={execute:()=>assert.fail('invalid query must not read')};
  for(const key of Object.keys(input))for(const value of [undefined,'',[input[key]],1])
    await assert.rejects(findWithdrawalReceipt(pool,{...input,[key]:value},config),/QUERY_INVALID/);
  for(const key of Object.keys(config))await assert.rejects(findWithdrawalReceipt(pool,input,{...config,[key]:null}),/QUERY_INVALID/);
});
