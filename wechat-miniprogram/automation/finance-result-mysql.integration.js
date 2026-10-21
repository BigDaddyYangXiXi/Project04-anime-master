const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const mysql=require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
const {saveFinanceResult}=require('../scripts/finance-tax-result-store');
const {snapshotHash}=require('../scripts/finance-tax-result-review');
if(process.env.PAYMENT_TEST_MYSQL_PORT!=='33317')throw Error('ISOLATED_LOCAL_PORT_REQUIRED');
const database='anime_finance_test_'+crypto.randomBytes(8).toString('hex');
const scope={appid:'wx_test',platformMchid:'test_merchant'};let admin,pool;
before(async()=>{
  admin=await mysql.createConnection({host:'127.0.0.1',port:33317,user:'root',password:''});
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool=mysql.createPool({host:'127.0.0.1',port:33317,user:'root',password:'',database});
  const sql=fs.readFileSync(path.join(__dirname,'../database/mysql/0051_finance_result_imports.sql'),'utf8');
  for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim()))await pool.query(statement);
});
after(async()=>{if(pool)await pool.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);await admin.end();}});
function fixture(){
  const review={batchId:'a'.repeat(32),status:'RESERVED_DRAFT',batchBlockers:[],remainingChecks:[],records:[{
    orderId:'o1',paymentId:'p1',providerId:'provider1',blockers:[],ledgerIssues:[],
    payment:{...scope,totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
    currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};
  const input={batchId:review.batchId,sourceSha256:snapshotHash(review),resultId:crypto.randomBytes(16).toString('hex'),evidenceReference:'fixture-only',records:[{
    orderId:'o1',paymentId:'p1',providerId:'provider1',taxPeriod:'2026-09',basisReference:'fixture-basis',providerPretaxFen:'8000',
    incomeTaxFen:'100',vatFen:'0',surchargeFen:'0',providerNetFen:'7900'}]};return {review,input};
}
test('20 concurrent imports persist one immutable pending result',async()=>{
  const {review,input}=fixture();const results=await Promise.all(Array.from({length:20},()=>saveFinanceResult(pool,scope,review,input,'finance')));
  assert.equal(new Set(results.map(r=>r.id)).size,1);assert.ok(results.every(r=>r.payable===false&&r.status==='IMPORTED_PENDING_REVIEW'));
  const [[row]]=await pool.execute('SELECT COUNT(*) AS n FROM finance_result_imports WHERE result_id=?',[input.resultId]);assert.equal(row.n,1);
});
test('same result with changed tax or operator cannot overwrite historical snapshot',async()=>{
  const {review,input}=fixture();await saveFinanceResult(pool,scope,review,input,'finance');
  await assert.rejects(saveFinanceResult(pool,scope,review,input,'other'),/CONFLICT/);
  input.records[0].incomeTaxFen='200';input.records[0].providerNetFen='7800';
  await assert.rejects(saveFinanceResult(pool,scope,review,input,'finance'),/CONFLICT/);
  const [[row]]=await pool.execute('SELECT result_snapshot FROM finance_result_imports WHERE result_id=?',[input.resultId]);
  const value=typeof row.result_snapshot==='string'?JSON.parse(row.result_snapshot):row.result_snapshot;
  assert.equal(value.records[0].incomeTaxFen,'100');assert.equal(value.operatorId,'finance');
});
test('foreign company and invalid amounts create no persisted result',async()=>{
  const {review,input}=fixture();await assert.rejects(saveFinanceResult(pool,{...scope,appid:'wx_other'},review,input,'finance'),/SCOPE_MISMATCH/);
  input.records[0].providerNetFen='8000';await assert.rejects(saveFinanceResult(pool,scope,review,input,'finance'),/RECONCILIATION/);
  const [[row]]=await pool.execute('SELECT COUNT(*) AS n FROM finance_result_imports WHERE result_id=?',[input.resultId]);assert.equal(row.n,0);
});
