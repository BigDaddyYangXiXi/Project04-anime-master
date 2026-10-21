const {snapshotHash,reviewFinanceTaxResult}=require('./finance-tax-result-review');
const headers=['批次编号','来源指纹','订单编号','付款记录编号','服务方编号','税前应结元','税款所属月','个人所得税元','增值税元','附加税费元','税后净额元','核算依据编号'];
function quote(value){return '"'+String(value??'').replaceAll('"','""')+'"';}
function yuan(value){
  if(!/^(0|[1-9]\d*)$/.test(String(value)))throw Error('FINANCE_CSV_AMOUNT_INVALID');
  const n=BigInt(value);return `${n/100n}.${String(n%100n).padStart(2,'0')}`;
}
function templateCsv(review){
  const hash=snapshotHash(review);
  const rows=review.records.map(row=>["'"+review.batchId,"'"+hash,"'"+row.orderId,"'"+row.paymentId,"'"+row.providerId,
    yuan(row.currentAmounts?.providerPretaxFen),'','','','','','']);
  return '\uFEFF'+[headers,...rows].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
// Strict comma CSV, including Excel escaped quotes and multiline cells; never evaluate formulas.
function parseCsv(text){
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}
      else cell+=c;
    }else if(c===','||c==='\r'||c==='\n'){
      row.push(cell);cell='';closed=false;
      if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}
    }else if(c==='"'&&!cell&&!closed){quoted=true;}
    else{if(closed||c==='"')throw Error('FINANCE_CSV_FORMAT_INVALID');cell+=c;}
  }
  if(quoted)throw Error('FINANCE_CSV_FORMAT_INVALID');
  if(cell||closed||row.length){row.push(cell);rows.push(row);}
  return rows;
}
function cents(value){
  if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value))throw Error('FINANCE_CSV_AMOUNT_INVALID');
  const [whole,fraction='']=value.split('.');return (BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'))).toString();
}
function reviewCsv(review,text,metadata,operatorId){
  const [head,...rows]=parseCsv(text);
  if(JSON.stringify(head)!==JSON.stringify(headers)||!rows.length)throw Error('FINANCE_CSV_HEADER_INVALID');
  const id=value=>value.startsWith("'")?value.slice(1):value;
  const hash=snapshotHash(review);
  const records=rows.map(row=>{
    if(row.length!==headers.length||id(row[0])!==review.batchId||id(row[1])!==hash)throw Error('FINANCE_CSV_SOURCE_MISMATCH');
    return {orderId:id(row[2]),paymentId:id(row[3]),providerId:id(row[4]),providerPretaxFen:cents(row[5]),
      taxPeriod:id(row[6]),incomeTaxFen:cents(row[7]),vatFen:cents(row[8]),surchargeFen:cents(row[9]),
      providerNetFen:cents(row[10]),basisReference:row[11]};
  });
  return reviewFinanceTaxResult(review,{resultId:metadata.resultId,evidenceReference:metadata.evidenceReference,
    batchId:review.batchId,sourceSha256:hash,records},operatorId);
}
module.exports={templateCsv,reviewCsv,parseCsv};
