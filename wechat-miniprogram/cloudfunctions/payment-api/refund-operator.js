const crypto = require('node:crypto');

// Separate operator credential and fixed server-side reviewer. Never a mini-program action.
async function operateRefund(event, caller, env, runtime, handlers = {
  review: require('./refund-store').reviewRefund,
  execute: require('./refund-execution').executeRefund,
  read: require('./refund-operator-read').readOperatorRefund,
  list: require('./refund-operator-read').listOperatorRefunds,
  paymentReviews: require('./payment-review-read').listPaymentReviews,
  fundAudit: require('./fund-audit').auditOperatorPayment,
  bankPreview: require('./bank-settlement-preview').readBankSettlementPreview
}) {
  const token = env.PAYMENT_REFUND_OPERATOR_TOKEN, reviewer = env.PAYMENT_REFUND_REVIEWER_ID;
  if (env.SCF_NAMESPACE !== 'cloudbase-d2g65rqbvee0bd978' || caller?.WX_OPENID || caller?.OPENID
    || !/^[a-f0-9]{64}$/.test(token || '') || !/^[A-Za-z0-9_-]{1,64}$/.test(reviewer || '')
    || !event || Array.isArray(event) || typeof event.operatorToken !== 'string'
    || !/^[a-f0-9]{64}$/.test(event.operatorToken)
    || !crypto.timingSafeEqual(Buffer.from(token,'hex'),Buffer.from(event.operatorToken,'hex'))) {
    return {ok:false,error:{code:'REFUND_OPERATOR_FORBIDDEN'}};
  }
  if(require('./bank-batch-actions').actions.includes(event.action)) {
    const bankOperator=env.BANK_BATCH_OPERATOR_ID;
    if(typeof bankOperator!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(bankOperator)) {
      return {ok:false,error:{code:'BANK_BATCH_OPERATOR_NOT_CONFIGURED'}};
    }
    const {operatorToken,...request}=event;
    return require('./bank-batch-actions').operateBankBatch(request,bankOperator,runtime);
  }
  const review = event.action === 'review', execute = event.action === 'execute', read = event.action === 'read', list = event.action === 'list';
  const paymentReviews=event.action==='paymentReviews';
  const bankPreview=event.action==='bankPreview';
  const fundAudit=event.action==='fundAudit'||bankPreview;
  const keys = fundAudit?['operatorToken','action','paymentId']:paymentReviews?['operatorToken','action','cursor']:list ? ['operatorToken','action','status','cursor'] : review ? ['operatorToken','action','refundId','decision','evidenceReference'] : ['operatorToken','action','refundId'];
  const filter = {status:event.status,cursor:event.cursor};
  if ((!review && !execute && !read && !list && !paymentReviews && !fundAudit) || Object.keys(event).some(key => !keys.includes(key))
    || (fundAudit ? typeof event.paymentId!=='string'||!/^[a-f0-9]{32}$/.test(event.paymentId) : paymentReviews ? !require('./payment-review-read').validReviewCursor(event.cursor) : list ? !require('./refund-operator-read').validListInput(filter) : typeof event.refundId !== 'string' || !/^[a-f0-9]{32}$/.test(event.refundId))
    || review && (!['APPROVE','REJECT'].includes(event.decision) || typeof event.evidenceReference !== 'string'
      || !event.evidenceReference.trim() || event.evidenceReference.length > 255)) {
    return {ok:false,error:{code:'REFUND_OPERATOR_INPUT_INVALID'}};
  }
  try {
    const {pool,config} = runtime();
    if (config.refundOperatorEnabled !== true || review && config.refundReviewEnabled !== true || execute && config.refundEnabled !== true) {
      return {ok:false,error:{code:'REFUND_OPERATOR_DISABLED'}};
    }
    if (list) return {ok:true,data:await handlers.list(pool,filter,config)};
    if (paymentReviews) return {ok:true,data:await handlers.paymentReviews(pool,event.cursor,config)};
    if (bankPreview) return {ok:true,data:await handlers.bankPreview(pool,event.paymentId,config)};
    if (fundAudit) return {ok:true,data:await handlers.fundAudit(pool,event.paymentId,config)};
    const snapshot = await handlers.read(pool,event.refundId,config);
    if (read) return {ok:true,data:snapshot};
    const result = review
      ? await handlers.review(pool,{refundId:event.refundId,reviewerId:reviewer,decision:event.decision,evidenceReference:event.evidenceReference})
      : await handlers.execute(pool,event.refundId,config);
    // No raw refund row, approval credential, payer account or channel payload leaves this entry.
    return {ok:true,data:{refundId:event.refundId,status:result.status}};
  } catch {
    // An execution failure may follow channel submission. Always query the original refund, never create another.
    return {ok:false,error:{code:execute ? 'REFUND_EXECUTION_QUERY_REQUIRED' : read || list || paymentReviews || fundAudit ? 'REFUND_OPERATOR_READ_FAILED' : 'REFUND_REVIEW_CHECK_REQUIRED'}};
  }
}
module.exports = {operateRefund};
