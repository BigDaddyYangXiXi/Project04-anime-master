// Generic finance review CSV. No bank file, payout approval, or status mutation.
const fs=require('node:fs');
const crypto=require('node:crypto');
function money(value){
  if(value===undefined||value===null)return '待核验';
  const text=String(value);
  if(!/^(0|[1-9][0-9]*)$/.test(text)||!Number.isSafeInteger(Number(text)))throw Error('INVALID_EXPORT_AMOUNT');
  const fen=BigInt(text);return `${fen/100n}.${String(fen%100n).padStart(2,'0')}`;
}
function cell(value,textId=false){
  let text=String(value??'');
  // Apostrophe keeps identifiers textual and prevents spreadsheet formula execution.
  if(textId||/^[\s\uFEFF]*[=+\-@]/u.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
function beijingTime(value){
  if(value===undefined||value===null)return '待核验';
  if(!/^[0-9]+$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw Error('INVALID_EXPORT_TIME');
  const date=new Date(Number(value)+8*60*60*1000);
  if(!Number.isFinite(date.getTime()))throw Error('INVALID_EXPORT_TIME');
  return date.toISOString().slice(0,19).replace('T',' ');
}
function validateAmounts(payment,amounts){
  const read=value=>{
    if(value===undefined||value===null)return null;
    money(value);return BigInt(String(value));
  };
  const total=read(payment.totalFen),refund=read(payment.refundedFen),originalFee=read(payment.originalPlatformFeeFen);
  const retained=read(amounts.retainedTotalFen),fee=read(amounts.platformFeeFen),provider=read(amounts.providerPretaxFen);
  if((total!==null&&refund!==null&&refund>total)
    ||(total!==null&&originalFee!==null&&originalFee>total)
    ||(retained!==null&&fee!==null&&fee>retained)
    ||(originalFee!==null&&fee!==null&&fee>originalFee)
    ||(total!==null&&refund!==null&&retained!==null&&total-refund!==retained)
    ||(retained!==null&&fee!==null&&provider!==null&&fee+provider!==retained))throw Error('EXPORT_AMOUNT_RECONCILIATION_FAILED');
}
function financeCsv(review,exportedAt=new Date().toISOString()){
  if(!review||!/^[a-f0-9]{32}$/.test(review.batchId)||!Array.isArray(review.records)||!review.records.length
    ||!Array.isArray(review.batchBlockers)||!Array.isArray(review.remainingChecks))throw Error('INVALID_BANK_REVIEW');
  const headers=['导出时间UTC','批次编号','批次状态','订单编号','付款记录编号','服务方内部编号','微信支付流水号',
    '订单状态','付款状态','支付时间戳毫秒','币种','订单原款元','渠道确认收款元','付款人实付元','累计退款元',
    '原平台费用元','退款后保留款元','退款后平台费用元','当前服务方税前应结元','批次原预留税前金额元','费用规则版本',
    '手续费承担方','实际渠道手续费元','收款户名','收款账号','收款开户行','税额元','税后付款额元','银行付款流水',
    '银行到账状态','批次核验问题','订单核验问题','账本问题','剩余核验项','平台商户号','小程序AppID','支付时间（北京时间）','用途'];
  const seen=new Set();
  const rows=review.records.map(row=>{
    if(!row||typeof row.paymentId!=='string'||seen.has(row.paymentId)||!Array.isArray(row.blockers)||!Array.isArray(row.ledgerIssues))throw Error('INVALID_BANK_REVIEW');
    seen.add(row.paymentId);
    const p=row.payment||{},a=row.currentAmounts||{};
    validateAmounts(p,a);
    const values=[exportedAt,review.batchId,review.status,row.orderId,row.paymentId,row.providerId,p.transactionId,
      p.orderStage,p.status,p.paidAt,p.currency||'待核验',money(p.totalFen),money(p.receivedTotalFen),money(p.payerPaidFen),money(p.refundedFen),
      money(p.originalPlatformFeeFen),money(a.retainedTotalFen),money(a.platformFeeFen),money(a.providerPretaxFen),money(row.reservedProviderPretaxFen),a.feeRuleVersion,
      '平台扣点承担','待核验','待补充','待补充','待补充','待核验','待核验','待核验','未核销',
      review.batchBlockers.join('；'),row.blockers.join('；'),row.ledgerIssues.map(i=>i.code).join('；'),review.remainingChecks.join('；'),
      p.platformMchid||'待核验',p.appid||'待核验',beijingTime(p.paidAt),
      '财务核对明细；导出不代表已付款或可付款'];
    return values.map((v,i)=>cell(v,[1,3,4,5,6,9,34,35].includes(i))).join(',');
  });
  return '\uFEFF'+[headers.map(h=>cell(h)).join(','),...rows].join('\r\n')+'\r\n';
}
function writeFinanceCsv(review,file,operatorId){
  if(typeof file!=='string'||!file.toLowerCase().endsWith('.csv'))throw Error('CSV_PATH_REQUIRED');
  if(typeof operatorId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(operatorId))throw Error('EXPORT_OPERATOR_REQUIRED');
  const exportedAt=new Date().toISOString(),csv=financeCsv(review,exportedAt);
  const audit={exportedAt,operatorId,batchId:review.batchId,rows:review.records.length,
    sha256:crypto.createHash('sha256').update(csv).digest('hex'),purpose:'FINANCE_REVIEW',bankSubmitted:false};
  // Reserve both names exclusively. If audit creation fails, remove only our new CSV.
  fs.writeFileSync(file,csv,{flag:'wx',mode:0o600});
  try{fs.writeFileSync(file+'.audit.json',JSON.stringify(audit,null,2),{flag:'wx',mode:0o600});}
  catch(error){fs.unlinkSync(file);throw error;}
  return {exported:true,rows:review.records.length,batchId:review.batchId,bankSubmitted:false};
}
module.exports={financeCsv,writeFinanceCsv};
