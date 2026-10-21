const {test}=require('node:test'),assert=require('node:assert/strict');
const {main}=require('./finance-result-import-cli');
const {snapshotHash}=require('./finance-tax-result-review');
function fixture(){
  const review={batchId:'a'.repeat(32),status:'RESERVED_DRAFT',batchBlockers:[],remainingChecks:[],records:[{
    paymentId:'p1',providerId:'s1',orderId:'o1',blockers:[],ledgerIssues:[],
    payment:{appid:'wxc94e1c1b38944511',platformMchid:'1750932981',totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
    currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};
  const input={batchId:review.batchId,sourceSha256:snapshotHash(review),resultId:'result1',evidenceReference:'finance-evidence',records:[{
    paymentId:'p1',providerId:'s1',orderId:'o1',taxPeriod:'2026-09',basisReference:'manual-basis',providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]};
  const env={ORDER_MYSQL_CONFIG:JSON.stringify({host:'db',database:'cloudbase-d2g65rqbvee0bd978',user:'am_finance_import',password:'fixture'}),BANK_BATCH_OPERATOR_ID:'finance'};
  let ended=0,connected=0;
  const deps={readFileSync:name=>JSON.stringify(name==='source'?review:input),createPool:config=>{
    connected++;assert.deepEqual(config.ssl,{rejectUnauthorized:true,verifyIdentity:true});assert.equal(config.multipleStatements,false);
    return {end:async()=>{ended++;}};
  },save:async(pool,scope,source,result,operator)=>{
    assert.equal(operator,'finance');assert.equal(scope.platformMchid,'1750932981');
    return {id:'record1',resultId:result.resultId,status:'IMPORTED_PENDING_REVIEW',privateValue:'must-not-leak'};
  }};
  return {review,input,env,deps,counts:()=>({ended,connected})};
}
test('imports with verified TLS and configured operator, returning only safe pending status',async()=>{
  const f=fixture();f.input.operatorId='forged';
  assert.deepEqual(await main(['--import','source','result'],f.env,f.deps),{id:'record1',resultId:'result1',status:'IMPORTED_PENDING_REVIEW',payable:false});
  assert.deepEqual(f.counts(),{connected:1,ended:1});
});
test('payment account or invalid financial result fails before a database connection',async()=>{
  const f=fixture();f.input.records[0].providerNetFen='8000';
  await assert.rejects(main(['--import','source','result'],f.env,f.deps),/RECONCILIATION/);
  f.env.ORDER_MYSQL_CONFIG=JSON.stringify({host:'db',database:'company',user:'am_payment',password:'fixture'});
  await assert.rejects(main(['--import','source','result'],f.env,f.deps),/CONFIG_REQUIRED/);
  assert.equal(f.counts().connected,0);
});
test('database failure closes the connection without producing an accepted result',async()=>{
  const f=fixture();f.deps.save=async()=>{throw Error('database failure');};
  await assert.rejects(main(['--import','source','result'],f.env,f.deps),/database failure/);
  assert.equal(f.counts().ended,1);
});

test('wrong database or non-dedicated account is rejected before reading financial files',async()=>{
  for(const change of [{user:'root'},{user:'am_payment'},{user:'am_notification'},{database:'other-company'},{password:''}]){
    const f=fixture();
    f.env.ORDER_MYSQL_CONFIG=JSON.stringify({...JSON.parse(f.env.ORDER_MYSQL_CONFIG),...change});
    f.deps.readFileSync=()=>{throw Error('FINANCIAL_FILE_MUST_NOT_BE_READ');};
    await assert.rejects(main(['--import','source','result'],f.env,f.deps),/FINANCE_IMPORT_CONFIG_REQUIRED/);
    assert.equal(f.counts().connected,0);
  }
});
