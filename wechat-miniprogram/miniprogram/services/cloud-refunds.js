const cloudCall = require("../utils/cloud-call");
const orders = require('./cloud-orders');
const localPreview = require('../utils/local-preview');
const STATES = ['REQUESTED','APPROVED','REJECTED','SUBMITTING','PROCESSING','SUCCESS','CLOSED','ABNORMAL'];
const messages = {
  REFUND_REQUEST_NOT_ENABLED:'退款申请暂未开放', REFUND_INPUT_INVALID:'请检查退款金额和原因',
  REFUND_AMOUNT_EXCEEDED:'退款金额超过可申请金额，请刷新后重试',
  REFUND_IDEMPOTENCY_CONFLICT:'申请内容已变化，请刷新后重试',
  REFUND_PAYMENT_NOT_READY:'付款状态待核对，暂不能申请退款',
  REFUND_NOT_FOUND:'未找到退款记录', ORDER_NOT_FOUND:'未找到订单', ACCOUNT_NOT_FOUND:'请重新登录',
  AUTH_CONTEXT_MISSING:'请重新登录'
};
function fail(code, fallback='暂时无法获取退款信息，请稍后重试') {
  const error = new Error(Object.prototype.hasOwnProperty.call(messages,code) ? messages[code] : fallback);
  error.code = code; throw error;
}
const id = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const orderId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
function record(row) {
  if (!row || !id(row.refundId) || !orderId(row.orderId) || !STATES.includes(row.status)
    || !Number.isSafeInteger(row.amountFen) || row.amountFen<=0 || !Number.isSafeInteger(row.createdAt) || row.createdAt<=0
    || !Number.isSafeInteger(row.updatedAt) || row.updatedAt<row.createdAt
    || row.succeededAt != null && (!Number.isSafeInteger(row.succeededAt) || row.succeededAt<=0)) fail('REFUND_RESPONSE_INVALID');
  return { refundId:row.refundId,orderId:row.orderId,amountFen:row.amountFen,status:row.status,
    createdAt:row.createdAt,updatedAt:row.updatedAt,succeededAt:row.succeededAt ?? null };
}
async function call(data) {
  if (!orders.isAvailable()) fail('CLOUD_UNAVAILABLE','退款服务暂不可用');
  localPreview.assertCloudAllowed();
  let response;
  try { response = await cloudCall.call(wx, {name:'payment-api',data}); }
  catch { fail('REFUND_REQUEST_FAILED','请求结果暂未确认，请查看退款记录后再操作'); }
  if (response?.result?.ok !== true) {
    const code=response?.result?.error?.code;
    fail(Object.prototype.hasOwnProperty.call(messages,code) ? code : 'REFUND_REQUEST_FAILED');
  }
  return response.result.data;
}
async function requestRefund(input) {
  if (!input || Object.keys(input).some(key=>!['orderId','paymentId','requestKey','amountFen','reason'].includes(key))
    || !orderId(input.orderId) || !id(input.paymentId) || typeof input.requestKey!=='string'
    || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestKey) || !Number.isSafeInteger(input.amountFen) || input.amountFen<=0
    || typeof input.reason!=='string' || !input.reason.trim()) fail('REFUND_INPUT_INVALID');
  // Caller persists this key with the draft. Never generate a new key or retry after a lost response.
  const result=record(await call({action:'requestRefund',...input}));
  if (result.orderId!==input.orderId || result.amountFen!==input.amountFen) fail('REFUND_RESPONSE_INVALID');
  return result;
}
async function getRefund(refundId) {
  if (!id(refundId)) fail('REFUND_INPUT_INVALID');
  const result=record(await call({action:'getRefund',refundId}));
  if (result.refundId!==refundId) fail('REFUND_RESPONSE_INVALID');
  return result;
}
async function findRefund(input) {
  if (!input || Object.keys(input).some(key=>!['orderId','paymentId','requestKey','amountFen'].includes(key))
    || !orderId(input.orderId) || !id(input.paymentId) || typeof input.requestKey!=='string'
    || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestKey) || !Number.isSafeInteger(input.amountFen) || input.amountFen<=0) fail('REFUND_INPUT_INVALID');
  const result=record(await call({action:'getRefund',orderId:input.orderId,paymentId:input.paymentId,requestKey:input.requestKey}));
  if (result.orderId!==input.orderId || result.amountFen!==input.amountFen) fail('REFUND_RESPONSE_INVALID');
  return result;
}
async function listRefunds(requestedOrderId,cursor=null) {
  if (!orderId(requestedOrderId)) fail('REFUND_INPUT_INVALID');
  const data=await call({action:'listRefunds',orderId:requestedOrderId,cursor});
  if (!data || !Array.isArray(data.records) || data.records.length>20) fail('REFUND_RESPONSE_INVALID');
  const records=data.records.map(record);
  if (records.some(row=>row.orderId!==requestedOrderId) || new Set(records.map(row=>row.refundId)).size!==records.length) fail('REFUND_RESPONSE_INVALID');
  const next=data.nextCursor;
  const last=records[records.length-1];
  if (next!=null && (!last || next.id!==last.refundId || next.createdAt!==last.createdAt)) fail('REFUND_RESPONSE_INVALID');
  return {records,nextCursor:next==null?null:{id:next.id,createdAt:next.createdAt}};
}
module.exports={requestRefund,getRefund,findRefund,listRefunds};
