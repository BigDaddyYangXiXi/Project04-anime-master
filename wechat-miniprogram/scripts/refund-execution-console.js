const fs=require('node:fs'),path=require('node:path');
const {runQuery,runExecution,executionEvent}=require('./refund-operator-console');
const facts=['refundId','orderId','paymentId','amountFen','totalFen','decision','reviewerId','evidenceReference','reviewedAt'];
function snapshot(row) {
  if(!row||row.decision!=='APPROVE'||!Number.isSafeInteger(row.amountFen)||row.amountFen<=0
    ||!Number.isSafeInteger(row.totalFen)||row.totalFen<row.amountFen||!Number.isSafeInteger(row.reviewedAt)||row.reviewedAt<=0
    ||['refundId','orderId','paymentId','reviewerId','evidenceReference'].some(key=>typeof row[key]!=='string'||!row[key]))throw Error('APPROVAL_REQUIRED');
  return Object.fromEntries(facts.map(key=>[key,row[key]]));
}
function executable(row) {
  if(row.status!=='APPROVED'||row.submissionStartedAt!=null||row.holdReason!=='REFUND_REQUEST'
    ||row.settlementReviewRequired||row.settlementTaskId||row.paymentStatus!=='PAID')throw Error('REFUND_NOT_EXECUTABLE');
}
function outcome(row,id) {
  if(row?.refundId!==id)throw Error('REFUND_RESULT_MISMATCH');
  return {refundId:id,status:row.status,submitted:row.submissionStartedAt!=null,
    needsQuery:!['SUCCESS','CLOSED'].includes(row.status),channelSuccess:row.status==='SUCCESS'};
}
async function prepareExecution(input,deployment,query=runQuery) {
  const request=executionEvent(input),row=await query({action:'read',refundId:request.refundId},deployment);
  if(row.refundId!==request.refundId)throw Error('REFUND_RESULT_MISMATCH');
  const approved=snapshot(row);executable(row);
  return {request,snapshot:approved};
}
async function applyExecution(plan,deployment,query=runQuery,submit=runExecution) {
  if(!plan||Object.keys(plan).some(key=>!['request','snapshot'].includes(key)))throw Error('INVALID_EXECUTION_PLAN');
  const request=executionEvent(plan.request),read=()=>query({action:'read',refundId:request.refundId},deployment);
  const row=await read();
  if(row.refundId!==request.refundId||JSON.stringify(snapshot(row))!==JSON.stringify(snapshot(plan.snapshot)))throw Error('REFUND_SNAPSHOT_CHANGED');
  // Persisted submission is an irrevocable local fence. Repeated use of a plan only reads its result.
  if(row.submissionStartedAt!=null)return outcome(row,request.refundId);
  executable(row);
  try {await submit(request,deployment);}catch {
    // The channel may have accepted. Never automatically submit again.
  }
  const stored=await read();
  if(stored.submissionStartedAt==null)throw Error('REFUND_SUBMISSION_NOT_CONFIRMED');
  return outcome(stored,request.refundId);
}
async function main() {
  const [mode,file,...extra]=process.argv.slice(2);
  if(!['--prepare','--apply'].includes(mode)||!file||extra.length)throw Error('INVALID_COMMAND');
  const deployment=JSON.parse(fs.readFileSync(path.join(__dirname,'../.cloudbase-cli-config/merchant-configured-closed/payment-refund-operator.json'),'utf8'));
  const input=JSON.parse(fs.readFileSync(file,'utf8'));
  console.log(JSON.stringify(await(mode==='--prepare'?prepareExecution(input,deployment):applyExecution(input,deployment)),null,2));
}
if(require.main===module)main().catch(()=>{console.error('退款执行未确认，请查询原退款编号；不要新建退款或重复提交渠道。');process.exitCode=1;});
module.exports={prepareExecution,applyExecution};
