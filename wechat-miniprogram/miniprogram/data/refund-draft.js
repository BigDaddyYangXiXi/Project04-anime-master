const refunds = require('../services/cloud-refunds');
const pending = new Map();
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function context(orderId) {
  const app = typeof getApp === 'function' ? getApp() : null;
  const owner = app?.globalData?.account?.id;
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(owner)) fail('AUTH_CONTEXT_MISSING');
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) fail('REFUND_INPUT_INVALID');
  return { owner, revision:app?.sessionRevision, key:`animeMasterRefundDraft:${owner}:${orderId}` };
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
  const {owner,key,revision}=context(orderId), draft=read(orderId);
  const current=()=>{ const now=context(orderId); return now.owner===owner && now.revision===revision; };
  if (!draft) fail('REFUND_DRAFT_MISSING');
  if (pending.get(key)?.revision===revision && pending.has(key)) return pending.get(key).promise;
  if (draft.state==='ACKNOWLEDGED') return refunds.getRefund(draft.refundId);
  // Persist before dispatch; storage failure must prevent sending a request with a lost key.
  wx.setStorageSync(key,{...draft,state:'UNKNOWN'});
  const send = () => refunds.requestRefund({orderId:draft.orderId,paymentId:draft.paymentId,amountFen:draft.amountFen,
    reason:draft.reason,requestKey:draft.requestKey});
  // An existing application remains readable even when new applications are disabled.
  const attempt = draft.state==='UNKNOWN'
    ? refunds.findRefund({orderId:draft.orderId,paymentId:draft.paymentId,requestKey:draft.requestKey,amountFen:draft.amountFen})
      .catch(error=>{ if (error?.code==='REFUND_NOT_FOUND' && current()) return send(); throw error; })
    : send();
  const promise=attempt.then(result=>{
    if (!current()) fail('AUTH_CONTEXT_CHANGED');
    wx.setStorageSync(key,{...draft,state:'ACKNOWLEDGED',refundId:result.refundId});
    return result;
  }).catch(error=>{
    // Only a first attempt explicitly rejected before creation may become editable again.
    // A retry of an unknown attempt might refer to an already committed application.
    const rejected=['REFUND_REQUEST_NOT_ENABLED','REFUND_INPUT_INVALID','REFUND_AMOUNT_EXCEEDED','REFUND_PAYMENT_NOT_READY','CLOUD_UNAVAILABLE'];
    if (draft.state==='DRAFT' && rejected.includes(error?.code) && current()) wx.setStorageSync(key,draft);
    throw error;
  }).finally(()=>{ if(pending.get(key)?.promise===promise)pending.delete(key); });
  pending.set(key,{revision,promise});
  return promise;
}
function startNext(orderId) {
  const {key}=context(orderId), draft=read(orderId);
  if (pending.has(key) || draft?.state==='UNKNOWN') fail('REFUND_DRAFT_LOCKED');
  wx.removeStorageSync(key);
}
module.exports={read,save,submit,startNext};
