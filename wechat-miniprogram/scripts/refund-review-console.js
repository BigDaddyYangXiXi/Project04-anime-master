const fs=require('node:fs'),path=require('node:path');
const {runQuery,runReview,reviewEvent}=require('./refund-operator-console');
function reviewerOf(deployment) {
  const fn=deployment.functions?.find(item=>item.name==='payment-refund-operator');
  const reviewer=fn?.envVariables?.PAYMENT_REFUND_REVIEWER_ID;
  if(typeof reviewer!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(reviewer)||reviewer==='refund_query_service')throw Error('REVIEWER_NOT_CONFIGURED');
  return reviewer;
}
const facts=['refundId','orderId','paymentId','amountFen','totalFen','reason','createdAt'];
function snapshotOf(row) {
  if(!row || !Number.isSafeInteger(row.amountFen)||row.amountFen<=0||!Number.isSafeInteger(row.totalFen)
    ||row.totalFen<row.amountFen||!Number.isSafeInteger(row.createdAt)||row.createdAt<=0
    ||typeof row.reason!=='string'||!row.reason.trim()
    ||['refundId','orderId','paymentId'].some(key=>typeof row[key]!=='string'||!row[key]))throw Error('REVIEW_SNAPSHOT_INVALID');
  return Object.fromEntries(facts.map(key=>[key,row[key]]));
}
async function prepareReview(input,deployment,query=runQuery) {
  const request=reviewEvent(input),reviewerId=reviewerOf(deployment);
  const row=await query({action:'read',refundId:request.refundId},deployment);
  if(row.status!=='REQUESTED'||row.decision!=null)throw Error('REVIEW_STATE_CHANGED');
  return {request,reviewerId,snapshot:snapshotOf(row)};
}
async function applyReview(plan,deployment,query=runQuery,submit=runReview) {
  if(!plan||Object.keys(plan).some(key=>!['request','reviewerId','snapshot'].includes(key)))throw Error('INVALID_REVIEW_PLAN');
  const request=reviewEvent(plan.request),reviewerId=reviewerOf(deployment);
  if(plan.reviewerId!==reviewerId)throw Error('REVIEWER_CHANGED');
  const current=await query({action:'read',refundId:request.refundId},deployment);
  if(JSON.stringify(snapshotOf(current))!==JSON.stringify(snapshotOf(plan.snapshot))||current.refundId!==request.refundId)throw Error('REVIEW_SNAPSHOT_CHANGED');
  const matches=row=>row.refundId===request.refundId && row.decision===request.decision && row.reviewerId===reviewerId
    && row.evidenceReference===request.evidenceReference && row.status!=='REQUESTED';
  if(current.decision!=null) {
    if(!matches(current))throw Error('REVIEW_CONFLICT');
    return {confirmed:true,alreadyRecorded:true,refundId:request.refundId,decision:request.decision};
  }
  if(current.status!=='REQUESTED')throw Error('REVIEW_STATE_CHANGED');
  // One submission only. Whether it succeeds or times out, confirm persisted decision by reading the original record.
  try {await submit(request,deployment);}catch {}
  const stored=await query({action:'read',refundId:request.refundId},deployment);
  if(!matches(stored))throw Error('REVIEW_NOT_CONFIRMED');
  return {confirmed:true,alreadyRecorded:false,refundId:request.refundId,decision:request.decision};
}
async function main() {
  const [mode,file,...extra]=process.argv.slice(2);
  if(!['--prepare','--apply'].includes(mode)||!file||extra.length)throw Error('INVALID_COMMAND');
  const deployment=JSON.parse(fs.readFileSync(path.join(__dirname,'../.cloudbase-cli-config/merchant-configured-closed/payment-refund-operator.json'),'utf8'));
  const input=JSON.parse(fs.readFileSync(file,'utf8'));
  console.log(JSON.stringify(await (mode==='--prepare'?prepareReview(input,deployment):applyReview(input,deployment)),null,2));
}
if(require.main===module)main().catch(()=>{console.error('审核未确认，请核对原退款记录、审核身份和配置；不要重复创建退款。');process.exitCode=1;});
module.exports={prepareReview,applyReview};
