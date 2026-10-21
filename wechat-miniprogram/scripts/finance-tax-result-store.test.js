const test=require('node:test'),assert=require('node:assert/strict');
const {saveFinanceResult,readFinanceResult}=require('./finance-tax-result-store');
const {snapshotHash}=require('./finance-tax-result-review');
function fixture(failure){
  const scope={appid:'wxc94e1c1b38944511',platformMchid:'1750932981'};
  const review={batchId:'a'.repeat(32),status:'RESERVED_DRAFT',batchBlockers:[],remainingChecks:[],records:[{
    orderId:'o1',paymentId:'p1',providerId:'s1',blockers:[],ledgerIssues:[],
    payment:{...scope,totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
    currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};
  const input={batchId:review.batchId,sourceSha256:snapshotHash(review),resultId:'r1',evidenceReference:'e1',records:[{
    orderId:'o1',paymentId:'p1',providerId:'s1',taxPeriod:'2026-09',basisReference:'b1',
    providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]};
  const calls=[];let stored;
  const connection={
    async beginTransaction(){calls.push('begin');},
    async execute(sql,args){
      if(sql.startsWith('INSERT')){calls.push('insert');stored ||= {id:args[0],appid:args[1],platform_mchid:args[2],result_id:args[3],batch_id:args[4],source_sha256:args[5],result_sha256:args[6],result_snapshot:JSON.parse(args[7]),created_by:args[8]};return [];}
      calls.push('select');return [[stored]];
    },
    async commit(){calls.push('commit');if(failure==='commit')throw Error('COMMIT_RESPONSE_LOST');},
    async rollback(){calls.push('rollback');if(failure==='rollback')throw Error('ROLLBACK_FAILED');},
    release(){calls.push('release');},destroy(){calls.push('destroy');}
  };
  const pool={async getConnection(){calls.push('connect');return connection;}};
  return {calls,input,review,scope,connection,stored:()=>stored,run:()=>saveFinanceResult(pool,scope,review,input,'finance_owner')};
}
test('same financial import is idempotent; changed evidence rolls back without approval',async()=>{
  const f=fixture();const first=await f.run(),second=await f.run();
  assert.equal(first.id,second.id);assert.equal(first.payable,false);assert.equal(first.status,'IMPORTED_PENDING_REVIEW');
  f.input.evidenceReference='changed';
  await assert.rejects(f.run(),/FINANCE_IMPORT_CONFLICT/);
  assert.deepEqual(f.calls.slice(-2),['rollback','release']);
  assert.equal(f.calls.filter(x=>x==='commit').length,2);
});
test('lost commit response never returns import success',async()=>{
  const f=fixture('commit');await assert.rejects(f.run(),/COMMIT_RESPONSE_LOST/);
  assert.deepEqual(f.calls.slice(-3),['commit','rollback','release']);
});
test('failed rollback destroys the connection rather than returning it to the pool',async()=>{
  const f=fixture('rollback');await f.run();f.input.evidenceReference='changed';
  await assert.rejects(f.run(),/FINANCE_IMPORT_CONFLICT/);
  assert.deepEqual(f.calls.slice(-2),['rollback','destroy']);
});
test('unreconciled amounts are rejected before opening a database connection',async()=>{
  const f=fixture();f.input.records[0].providerNetFen='8000';
  await assert.rejects(f.run(),/RECONCILIATION/);assert.deepEqual(f.calls,[]);
});

test('matching missing source identities cannot be imported or open a connection',async()=>{
  for(const key of ['orderId','providerId']){
    const f=fixture();delete f.review.records[0][key];delete f.input.records[0][key];
    f.input.sourceSha256=snapshotHash(f.review);
    await assert.rejects(f.run(),/FINANCE_RESULT_SOURCE_INVALID/);assert.deepEqual(f.calls,[]);
  }
});

test('stored result is reconstructed after database JSON key reordering without owning the transaction',async()=>{
  const f=fixture(),saved=await f.run();
  const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)])):value;
  f.stored().result_snapshot=reorder(f.stored().result_snapshot);
  f.calls.length=0;
  const read=await readFinanceResult(f.connection,f.scope,saved.id,f.review);
  assert.equal(read.result.records[0].providerNetFen,'7900');assert.equal(read.payable,false);
  assert.deepEqual(f.calls,['select']);
  f.stored().result_snapshot=JSON.stringify(f.stored().result_snapshot);
  assert.deepEqual(await readFinanceResult(f.connection,f.scope,saved.id,f.review),read);
});

test('changed evidence, balanced replacement amounts and row metadata are rejected',async()=>{
  for(const change of [
    row=>{row.result_snapshot.evidenceReference='replacement';},
    row=>{row.result_snapshot.records[0].incomeTaxFen='200';row.result_snapshot.records[0].providerNetFen='7800';},
    row=>{row.batch_id='b'.repeat(32);},
    row=>{row.created_by='another';},
    row=>{row.appid='other';},
    row=>{row.result_snapshot='{';}
  ]){
    const f=fixture(),saved=await f.run();change(f.stored());f.calls.length=0;
    await assert.rejects(readFinanceResult(f.connection,f.scope,saved.id,f.review),/FINANCE_IMPORT_/);
    assert.deepEqual(f.calls,['select']);
  }
});

test('reader restricts scope in SQL and rejects missing records and malformed IDs',async()=>{
  const scope={appid:'app',platformMchid:'merchant'},id='a'.repeat(32);let calls=0;
  const connection={async execute(sql,args){calls++;assert.match(sql,/WHERE id=\? AND appid=\? AND platform_mchid=\?/);assert.deepEqual(args,[id,scope.appid,scope.platformMchid]);return [[]];}};
  await assert.rejects(readFinanceResult(connection,scope,'bad',{}),/ID_INVALID/);assert.equal(calls,0);
  await assert.rejects(readFinanceResult(connection,scope,id,{}),/NOT_FOUND/);assert.equal(calls,1);
});
