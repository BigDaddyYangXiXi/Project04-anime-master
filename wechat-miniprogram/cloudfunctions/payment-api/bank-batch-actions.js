const actions = ['bankReserve','bankCancel','bankReview','bankFind'];
function validBankBatchEvent(event) {
  if(!event||Array.isArray(event)||!actions.includes(event.action))return false;
  const fields=event.action==='bankFind'?['requestKey']:event.action==='bankReserve'?['requestKey','paymentIds']:event.action==='bankCancel'?['batchId','reason']:['batchId'];
  if(Object.keys(event).some(key=>!['action',...fields].includes(key)))return false;
  if(event.action==='bankFind')return typeof event.requestKey==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(event.requestKey);
  if(event.action==='bankReserve')return typeof event.requestKey==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(event.requestKey)
    &&Array.isArray(event.paymentIds)&&event.paymentIds.length>0&&event.paymentIds.length<=100
    &&event.paymentIds.every(id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id))&&new Set(event.paymentIds).size===event.paymentIds.length;
  return typeof event.batchId==='string'&&/^[a-f0-9]{32}$/.test(event.batchId)
    &&(event.action!=='bankCancel'||typeof event.reason==='string'&&!!event.reason.trim()&&event.reason.length<=255);
}
// Called only after the existing private operator credential and caller checks.
async function operateBankBatch(event,operatorId,runtime,handlers={
  reserve:require('./bank-settlement-store').reserveBankBatch,
  cancel:require('./bank-settlement-store').cancelBankBatch,
  read:require('./bank-batch-review').readBankBatchReview,
  find:require('./bank-settlement-store').findBankBatch
}) {
  if(!validBankBatchEvent(event)||typeof operatorId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(operatorId))
    return {ok:false,error:{code:'BANK_BATCH_INPUT_INVALID'}};
  try {
    const {pool,config}=runtime();
    if(config.refundOperatorEnabled!==true||config.bankBatchEnabled!==true)return {ok:false,error:{code:'BANK_BATCH_DISABLED'}};
    if(event.action==='bankFind')return {ok:true,data:await handlers.find(pool,event.requestKey,config)};
    if(event.action==='bankReview')return {ok:true,data:await handlers.read(pool,event.batchId,config)};
    const {action,...input}=event;
    const result=await handlers[action==='bankReserve'?'reserve':'cancel'](pool,{...input,operatorId},config);
    return {ok:true,data:{batchId:result.batchId,status:result.status,payable:false}};
  }catch {
    return {ok:false,error:{code:['bankReview','bankFind'].includes(event.action)?'BANK_BATCH_READ_FAILED':'BANK_BATCH_QUERY_REQUIRED'}};
  }
}
module.exports={actions,validBankBatchEvent,operateBankBatch};
