const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {financeCsv,writeFinanceCsv}=require('./bank-finance-export');
function fixture(){return {batchId:'a'.repeat(32),status:'RESERVED_DRAFT',batchBlockers:[],remainingChecks:['BANK_ACCOUNT_AND_TAX_CHECK_REQUIRED'],records:[{
  orderId:'order_1',paymentId:'b'.repeat(32),providerId:'provider_1',payment:{transactionId:'4200001234567890123456789012345',status:'PAID',orderStage:'COMPLETED',currency:'CNY',totalFen:'10001',receivedTotalFen:'10001',payerPaidFen:'9801',refundedFen:'3000',originalPlatformFeeFen:'2000',paidAt:'1790490000000'},
  currentAmounts:{retainedTotalFen:7001,platformFeeFen:1400,providerPretaxFen:5601,feeRuleVersion:'fee-v1'},reservedProviderPretaxFen:8001,blockers:['SOURCE_SNAPSHOT_CHANGED'],ledgerIssues:[]}]};}
test('finance export preserves long identifiers, cents, refund changes and missing account/tax facts',()=>{
 const csv=financeCsv(fixture(),'2026-09-27T00:00:00.000Z');
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'4200001234567890123456789012345"'));
 for(const amount of ['100.01','98.01','30.00','70.01','14.00','56.01','80.01'])assert.ok(csv.includes('"'+amount+'"'));
 assert.ok(csv.includes('SOURCE_SNAPSHOT_CHANGED'));assert.ok(csv.includes('平台扣点承担'));assert.ok(csv.includes('待补充'));assert.ok(csv.includes('税后付款额元'));assert.ok(csv.includes('未核销'));
});
test('finance export neutralizes spreadsheet expressions and quotes multiline text',()=>{
 const f=fixture();f.records[0].providerId=' =1+1';f.records[0].blockers=['@SUM(1,2)','line "quoted"\nnext'];
 const csv=financeCsv(f);assert.ok(csv.includes('"\' =1+1"'));assert.ok(csv.includes('"\'@SUM(1,2)；line ""quoted""\nnext"'));
});
test('invalid amounts and duplicate payment sources do not produce a misleading file',()=>{
 const f=fixture();f.records[0].payment.totalFen='1e4';assert.throws(()=>financeCsv(f),/INVALID_EXPORT_AMOUNT/);
 const duplicate=fixture();duplicate.records.push(duplicate.records[0]);assert.throws(()=>financeCsv(duplicate),/INVALID_BANK_REVIEW/);
});
test('finance export binds merchant identity and uses Beijing date across UTC midnight',()=>{
 const f=fixture();Object.assign(f.records[0].payment,{appid:'wx_test',platformMchid:'1750932981',paidAt:String(Date.parse('2026-09-26T16:01:02Z'))});
 const csv=financeCsv(f);assert.ok(csv.includes('"\'1750932981"'));assert.ok(csv.includes('"\'wx_test"'));assert.ok(csv.includes('"2026-09-27 00:01:02"'));
 f.records[0].payment.paidAt='not-a-time';assert.throws(()=>financeCsv(f),/INVALID_EXPORT_TIME/);
});
test('inconsistent settlement arithmetic is rejected before creating finance files',()=>{
 const changes=[f=>{f.records[0].payment.refundedFen='10002';},f=>{f.records[0].payment.originalPlatformFeeFen='10002';},
 f=>{f.records[0].currentAmounts.retainedTotalFen=7002;},f=>{f.records[0].currentAmounts.providerPretaxFen=5602;},
 f=>{f.records[0].currentAmounts.platformFeeFen=2100;f.records[0].currentAmounts.providerPretaxFen=4901;},
 f=>{f.records[0].currentAmounts.platformFeeFen=7002;}];
 for(const change of changes){const f=fixture();change(f);assert.throws(()=>financeCsv(f),/EXPORT_AMOUNT_RECONCILIATION_FAILED/);}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bank-reconcile-test-')),file=path.join(dir,'finance.csv');
 try{const f=fixture();changes[2](f);assert.throws(()=>writeFinanceCsv(f,file,'finance_owner'),/RECONCILIATION_FAILED/);
 assert.equal(fs.existsSync(file),false);assert.equal(fs.existsSync(file+'.audit.json'),false);
 }finally{fs.rmdirSync(dir);}
});
test('full refunds preserve zero and missing facts remain unknown; reserved snapshot is not current payable',()=>{
 const f=fixture();f.records[0].payment.refundedFen='10001';Object.assign(f.records[0].currentAmounts,{retainedTotalFen:0,platformFeeFen:0,providerPretaxFen:0});
 const csv=financeCsv(f);assert.ok(csv.includes('"0.00"'));assert.ok(csv.includes('"80.01"'));
 delete f.records[0].currentAmounts.providerPretaxFen;
 assert.ok(financeCsv(f).includes('"待核验"'));
});
test('export refuses to overwrite an existing finance file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bank-finance-test-')),file=path.join(dir,'finance.csv');
 try{const f=fixture();assert.equal(writeFinanceCsv(f,file,'finance_owner').bankSubmitted,false);const before=fs.readFileSync(file);
 const audit=JSON.parse(fs.readFileSync(file+'.audit.json'));
 assert.equal(audit.operatorId,'finance_owner');assert.equal(audit.sha256,require('node:crypto').createHash('sha256').update(before).digest('hex'));
 assert.equal(JSON.stringify(audit).includes(f.records[0].payment.transactionId),false);
 assert.throws(()=>writeFinanceCsv(f,file,'finance_owner'),e=>e.code==='EEXIST');assert.deepEqual(fs.readFileSync(file),before);
 }finally{fs.unlinkSync(file);fs.unlinkSync(file+'.audit.json');fs.rmdirSync(dir);}
});
test('audit file conflict leaves existing audit intact and no unaudited new CSV',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bank-audit-test-')),file=path.join(dir,'finance.csv');
 try{fs.writeFileSync(file+'.audit.json','existing');
 assert.throws(()=>writeFinanceCsv(fixture(),file,'finance_owner'),e=>e.code==='EEXIST');
 assert.equal(fs.existsSync(file),false);assert.equal(fs.readFileSync(file+'.audit.json','utf8'),'existing');
 assert.throws(()=>writeFinanceCsv(fixture(),file),/EXPORT_OPERATOR_REQUIRED/);
 }finally{fs.unlinkSync(file+'.audit.json');fs.rmdirSync(dir);}
});
