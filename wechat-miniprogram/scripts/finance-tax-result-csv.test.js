const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {templateCsv,reviewCsv,parseCsv}=require('./finance-tax-result-csv');
const {main}=require('./finance-tax-result-cli');
function fixture(){return {batchId:'a'.repeat(32),status:'RESERVED_DRAFT',batchBlockers:[],remainingChecks:[],records:[{
  orderId:'123456789012345678901',paymentId:'p1',providerId:'provider1',blockers:[],ledgerIssues:[],
  payment:{totalFen:10000,refundedFen:0,originalPlatformFeeFen:2000},
  currentAmounts:{retainedTotalFen:10000,platformFeeFen:2000,providerPretaxFen:8000}}]};}
const metadata={resultId:'result1',evidenceReference:'restricted-finance-evidence'};
function filled(review){const rows=parseCsv(templateCsv(review));rows[1].splice(6,6,'2026-09','3.01','0','0','76.99','凭据"A",第1行\n附件');return rows;}
function encode(rows){return rows.map(row=>row.map(value=>'"'+value.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';}
test('spreadsheet roundtrip preserves long IDs, quoted evidence and exact cents',()=>{
  const r=fixture();const result=reviewCsv(r,encode(filled(r)),metadata,'finance_owner');
  assert.equal(result.records[0].orderId,r.records[0].orderId);
  assert.equal(result.records[0].withholdingFen,'301');assert.equal(result.records[0].providerNetFen,'7699');
  assert.equal(result.records[0].basisReference,'凭据"A",第1行\n附件');assert.equal(result.payable,false);
});
test('untouched template, formulas, extra decimals and blank taxes fail',()=>{
  const r=fixture();assert.throws(()=>reviewCsv(r,templateCsv(r),metadata,'finance_owner'));
  for(const value of ['', '=SUM(3,1)', '3.001', '-3', '3e1']){
    const rows=filled(r);rows[1][7]=value;assert.throws(()=>reviewCsv(r,encode(rows),metadata,'finance_owner'),/AMOUNT_INVALID/);
  }
});
test('tampered source, missing header, duplicate row and wrong net do not pass',()=>{
  const r=fixture();
  for(const mutate of [rows=>rows[1][1]='wrong',rows=>rows[0][0]='wrong',rows=>rows.push(rows[1]),rows=>rows[1][10]='70']){
    const rows=filled(r);mutate(rows);assert.throws(()=>reviewCsv(r,encode(rows),metadata,'finance_owner'));
  }
  assert.throws(()=>parseCsv('"unterminated'),/FORMAT_INVALID/);
  assert.throws(()=>parseCsv('"closed"trailing'),/FORMAT_INVALID/);
});
test('CLI exports template and imports filled CSV; invalid input creates no output and files are not overwritten',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'finance-csv-'));
  const source=path.join(dir,'source.json'),csv=path.join(dir,'finance.csv'),meta=path.join(dir,'meta.json'),output=path.join(dir,'result.json');
  try{
    const r=fixture();fs.writeFileSync(source,JSON.stringify(r));fs.writeFileSync(meta,JSON.stringify(metadata));
    assert.equal(main(['--template',source,csv]).templateCreated,true);
    assert.throws(()=>main(['--review-csv',source,csv,meta,output,'finance_owner']));assert.equal(fs.existsSync(output),false);
    fs.writeFileSync(csv,encode(filled(r)));assert.equal(main(['--review-csv',source,csv,meta,output,'finance_owner']).records,1);
    const original=fs.readFileSync(output,'utf8');assert.throws(()=>main(['--review-csv',source,csv,meta,output,'finance_owner']),{code:'EEXIST'});
    assert.equal(fs.readFileSync(output,'utf8'),original);
  }finally{for(const file of [source,csv,meta,output])if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
});
