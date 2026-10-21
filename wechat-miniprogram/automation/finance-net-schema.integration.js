const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const mysql=require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
if(process.env.PAYMENT_TEST_MYSQL_PORT!=='33317')throw Error('ISOLATED_LOCAL_PORT_REQUIRED');
const database='anime_net_schema_test_'+crypto.randomBytes(8).toString('hex');let admin,pool;
before(async()=>{
  admin=await mysql.createConnection({host:'127.0.0.1',port:33317,user:'root',password:''});
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool=mysql.createPool({host:'127.0.0.1',port:33317,user:'root',password:'',database});
  // Only FK type/constraint validation here, not the complete payment schema or approval writer.
  await pool.query('CREATE TABLE order_payments(id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY)');
  await pool.query('CREATE TABLE fund_journals(id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY)');
  for(const file of ['0051_finance_result_imports.sql','0052_finance_net_settlements.sql']){
    const sql=fs.readFileSync(path.join(__dirname,'../database/mysql',file),'utf8');
    for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim()))await pool.query(statement);
  }
  await pool.execute(`INSERT INTO finance_result_imports VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ['a'.repeat(32),'test','test','r','b'.repeat(32),'c'.repeat(64),'d'.repeat(64),'{}','finance',1]);
});
after(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);await admin.end();}});
async function row(net=7900,tax=100,reference='a'.repeat(32)){
  const id=crypto.randomBytes(16).toString('hex'),journal='net:'+id;
  await pool.execute('INSERT INTO order_payments VALUES(?)',[id]);
  await pool.execute('INSERT INTO fund_journals VALUES(?)',[journal]);
  const args=[id,reference,journal,'provider','c'.repeat(64),8000,tax,0,0,net,'finance',1];
  return {id,args,insert:()=>pool.execute('INSERT INTO finance_net_settlements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',args)};
}
test('balanced net is persisted once per payment and linked to its evidence',async()=>{
  const value=await row();await value.insert();
  await assert.rejects(value.insert(),e=>e.code==='ER_DUP_ENTRY');
  const [[stored]]=await pool.execute('SELECT provider_net_fen FROM finance_net_settlements WHERE payment_id=?',[value.id]);
  assert.equal(stored.provider_net_fen,7900);
});
test('zero net is allowed when all pretax income is withheld',async()=>{await (await row(0,8000)).insert();});
test('concurrent different journals cannot settle the same payment twice',async()=>{
  const value=await row();
  const attempts=await Promise.all(Array.from({length:20},async()=>{
    const args=[...value.args];args[2]='net:'+crypto.randomBytes(16).toString('hex');
    await pool.execute('INSERT INTO fund_journals VALUES(?)',[args[2]]);
    return args;
  }));
  const results=await Promise.allSettled(attempts.map(args=>pool.execute('INSERT INTO finance_net_settlements VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',args)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='ER_DUP_ENTRY'));
});
test('unbalanced amounts and missing financial evidence are rejected',async()=>{
  await assert.rejects((await row(8000,100)).insert(),e=>e.code==='ER_CHECK_CONSTRAINT_VIOLATED');
  await assert.rejects((await row(7900,100,'f'.repeat(32))).insert(),e=>e.code==='ER_NO_REFERENCED_ROW_2');
});

test('financial evidence survives actual MySQL JSON storage and rejects other scopes or changed amounts',async()=>{
  const {saveFinanceResult,readFinanceResult}=require('../scripts/finance-tax-result-store');
  const {snapshotHash}=require('../scripts/finance-tax-result-review');
  const scope={appid:'test',platformMchid:'test'};
  const review={batchId:'e'.repeat(32),status:'RESERVED_DRAFT',batchBlockers:[],remainingChecks:[],records:[{
    orderId:'order',paymentId:'payment',providerId:'provider',blockers:[],ledgerIssues:[],
    payment:{...scope,totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
    currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};
  const input={batchId:review.batchId,sourceSha256:snapshotHash(review),resultId:'roundtrip',evidenceReference:'finance-reference',records:[{
    orderId:'order',paymentId:'payment',providerId:'provider',taxPeriod:'2026-09',basisReference:'manual',
    providerPretaxFen:'8000',incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]};
  const saved=await saveFinanceResult(pool,scope,review,input,'finance');
  const connection=await pool.getConnection();
  try{
    const result=await readFinanceResult(connection,scope,saved.id,review);
    assert.equal(result.result.records[0].providerNetFen,'7900');assert.equal(result.payable,false);
    await assert.rejects(readFinanceResult(connection,{...scope,appid:'other'},saved.id,review),/NOT_FOUND/);
    await connection.beginTransaction();
    await connection.execute(`UPDATE finance_result_imports SET result_snapshot=JSON_SET(result_snapshot,
      '$.records[0].incomeTaxFen','200','$.records[0].providerNetFen','7800') WHERE id=?`,[saved.id]);
    await assert.rejects(readFinanceResult(connection,scope,saved.id,review),/HASH_MISMATCH/);
    await connection.rollback();
    assert.equal((await readFinanceResult(connection,scope,saved.id,review)).result.records[0].providerNetFen,'7900');
  }finally{await connection.rollback();connection.release();}
});
