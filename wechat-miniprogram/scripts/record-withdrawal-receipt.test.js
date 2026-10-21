const test=require('node:test'),assert=require('node:assert/strict');
const {recordWithdrawalReceipt}=require('./record-withdrawal-receipt');
const config={appid:'wx_test',platformMchid:'test_merchant'};
const valid={eventId:'a'.repeat(32),requestId:'b'.repeat(32),paymentId:'c'.repeat(32),accountVersionId:'d'.repeat(32),
  providerId:'provider',operatorId:'finance',amountFen:'100',status:'SUCCEEDED',evidenceReference:'synthetic-proof',
  bankResultVerified:true,bankTransactionReference:'123456'};

test('receipt rejects coerced identifiers before obtaining a database connection',async()=>{
  const pool={getConnection:async()=>assert.fail('invalid receipt must not reach database')};
  for(const field of ['eventId','requestId','paymentId','accountVersionId','providerId','operatorId','bankTransactionReference']) {
    for(const value of [[valid[field]],{toString:()=>valid[field]}]) {
      await assert.rejects(recordWithdrawalReceipt(pool,{...valid,[field]:value},config),/WITHDRAWAL_RECEIPT_INVALID/,field);
    }
  }
  await assert.rejects(recordWithdrawalReceipt(pool,{...valid,bankTransactionReference:123456},config),/WITHDRAWAL_RECEIPT_INVALID/);
});

test('valid text identifiers retain exact leading zeros at the transaction boundary',async()=>{
  const input={...valid,bankTransactionReference:'000123456'};
  let acquired=false;
  const pool={getConnection:async()=>{acquired=true;throw Error('SYNTHETIC_DB_BOUNDARY');}};
  await assert.rejects(recordWithdrawalReceipt(pool,input,config),/SYNTHETIC_DB_BOUNDARY/);
  assert.equal(acquired,true);
  assert.equal(input.bankTransactionReference,'000123456');
});
