const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {withdrawalReceiptHash}=require('./withdrawal-receipt-hash');
test('shared receipt fingerprint preserves the already persisted format exactly',()=>{
  const config={appid:'wx_test',platformMchid:'merchant'};
  for(const status of ['UNKNOWN','SUCCEEDED','FAILED']){
    const input={requestId:'a'.repeat(32),paymentId:'b'.repeat(32),providerId:'provider',accountVersionId:'c'.repeat(32),
      amountFen:'9007199254740992',operatorId:'finance',status,evidenceReference:'private-proof',
      bankTransactionReference:status==='SUCCEEDED'?'000123':null};
    const original={requestId:input.requestId,paymentId:input.paymentId,providerId:input.providerId,
      accountVersionId:input.accountVersionId,amountFen:input.amountFen,operatorId:input.operatorId,
      status,evidenceReference:input.evidenceReference,appid:config.appid,platformMchid:config.platformMchid,
      bankTransactionReference:input.bankTransactionReference};
    assert.equal(withdrawalReceiptHash(input,config),crypto.createHash('sha256').update(JSON.stringify(original)).digest('hex'));
    assert.notEqual(withdrawalReceiptHash({...input,amountFen:'1'},config),withdrawalReceiptHash(input,config));
  }
});
