const refunds = require('../services/cloud-refunds');
const pending = new Map();
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function context(orderId) {
  const owner = typeof getApp === 'function' && getApp()?.globalData?.account?.id;
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(owner)) fail('AUTH_CONTEXT_MISSING');
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) fail('REFUND_INPUT_INVALID');
  return { owner, key:`animeMasterRefundDraft:${owner}:${orderId}` };
}
function read(orderId) {
  const {owner,key}=context(orderId), draft=wx.getStorageSync(key);
  if (!draft) return null;
  if (draft.owner!==owner || draft.orderId!==orderId || !['DRAFT','UNKNOWN','ACKNOWLEDGED'].includes(draft.state)
    || typeof draft.requestKey!=='string' || !/^[A-Za-z0-9_-]{16,128}$/.test(draft.requestKey)) fail('REFUND_DRAFT_INVALID');
  return draft;
}
function save(input) {
  const {owner,key}=context(input?.orderId), previous=read(input.orderId);
  if (!input || Object.keys(input).some(name=>!['orderId','paymentId','amountFen','reason'].includes(name))
    || typeof input.paymentId!=='string' || !/^[a-f0-9]{32}$/.test(input.paymentId)
    || !Number.isSafeInteger(input.amountFen) || input.amountFen<=0 || typeof input.reason!=='string' || !input.reason.trim()) fail('REFUND_INPUT_INVALID');
  const same=previous && ['paymentId','amountFen','reason'].every(name=>previous[name]===input[name]);
  if (previous && previous.state!=='DRAFT') {
    if (same) return previous;
    fail('REFUND_DRAFT_LOCKED');
  }
  const draft={...input,owner,state:'DRAFT',requestKey:previous?.requestKey || `refund-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`};
  wx.setStorageSync(key,draft);
  return draft;
}
function submit(orderId) {
  const {owner,key}=context(orderId), draft=read(orderId);
  if (!draft) fail('REFUND_DRAFT_MISSING');
  if (pending.has(key)) return pending.get(key);
  if (draft.state==='ACKNOWLEDGED') return refunds.getRefund(draft.refundId);
  // Persist before dispatch. A write failure prevents a request whose idempotency key could be lost.
  wx.setStorageSync(key,{...draft,state:'UNKNOWN'});
  const promise=refunds.requestRefund({orderId:draft.orderId,paymentId:draft.paymentId,amountFen:draft.amountFen,
    reason:draft.reason,requestKey:draft.requestKey}).then(result=>{
    if (context(orderId).owner!==owner) fail('AUTH_CONTEXT_CHANGED');
    wx.setStorageSync(key,{...draft,state:'ACKNOWLEDGED',refundId:result.refundId});
    return result;
  }).finally(()=>pending.delete(key));
  pending.set(key,promise);
  return promise;
}
function startNext(orderId) {
  const {key}=context(orderId), draft=read(orderId);
  if (pending.has(key) || draft?.state==='UNKNOWN') fail('REFUND_DRAFT_LOCKED');
  wx.removeStorageSync(key);
}
module.exports={read,save,submit,startNext};
