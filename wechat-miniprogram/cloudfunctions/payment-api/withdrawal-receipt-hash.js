const crypto=require('node:crypto');
// Preserve the original persisted receipt fingerprint, including field order.
function withdrawalReceiptHash(input,config){
  const snapshot=Object.fromEntries(['requestId','paymentId','providerId','accountVersionId','amountFen','operatorId','status','evidenceReference'].map(k=>[k,input[k]]));
  Object.assign(snapshot,{appid:config.appid,platformMchid:config.platformMchid,bankTransactionReference:input.bankTransactionReference||null});
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
module.exports={withdrawalReceiptHash};
