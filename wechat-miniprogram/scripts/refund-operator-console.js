// Local query CLI and private transport for separate review/execution tools.
const fs = require('node:fs'), path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const envId = 'cloudbase-d2g65rqbvee0bd978', functionName = 'payment-refund-operator';

function queryEvent(input) {
  if (!input || Array.isArray(input)) throw Error('INVALID_QUERY');
  if(['bankReview','bankFind'].includes(input.action)&&require('../cloudfunctions/payment-api/bank-batch-actions').validBankBatchEvent(input))return {...input};
  if(['fundAudit','bankPreview'].includes(input.action)&&Object.keys(input).every(key=>['action','paymentId'].includes(key))
    &&typeof input.paymentId==='string'&&/^[a-f0-9]{32}$/.test(input.paymentId))return {...input};
  if(input.action==='paymentReviews'&&Object.keys(input).every(key=>['action','cursor'].includes(key))
    &&require('../cloudfunctions/payment-api/payment-review-read').validReviewCursor(input.cursor))return {...input};
  if (input.action === 'read' && Object.keys(input).every(key=>['action','refundId'].includes(key))
    && typeof input.refundId === 'string' && /^[a-f0-9]{32}$/.test(input.refundId)) return {...input};
  if (input.action === 'list' && Object.keys(input).every(key=>['action','status','cursor'].includes(key))
    && require('../cloudfunctions/payment-api/refund-operator-read').validListInput({status:input.status,cursor:input.cursor})) return {...input};
  throw Error('INVALID_QUERY');
}
function runQuery(input, deployment, spawn = spawnSync) {
  return invokeOperator(queryEvent(input),deployment,spawn);
}
function bankMutationEvent(input) {
  if(!['bankReserve','bankCancel'].includes(input?.action)
    ||!require('../cloudfunctions/payment-api/bank-batch-actions').validBankBatchEvent(input))throw Error('INVALID_BANK_MUTATION');
  return {...input};
}
function runBankMutation(input,deployment,spawn=spawnSync) {
  const event=bankMutationEvent(input);
  const fn=deployment?.functions?.find(item=>item.name===functionName);
  if(typeof fn?.envVariables?.BANK_BATCH_OPERATOR_ID!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(fn.envVariables.BANK_BATCH_OPERATOR_ID))throw Error('BANK_BATCH_OPERATOR_NOT_CONFIGURED');
  const config=JSON.parse(Buffer.from(fn?.envVariables?.PAYMENT_WECHAT_CONFIG_B64||'','base64').toString('utf8'));
  if(config.refundOperatorEnabled!==true||config.bankBatchEnabled!==true)throw Error('BANK_BATCH_DISABLED');
  return invokeOperator(event,deployment,spawn);
}
function reviewEvent(input) {
  if (!input || input.action !== 'review' || Object.keys(input).some(key=>!['action','refundId','decision','evidenceReference'].includes(key))
    || typeof input.refundId !== 'string' || !/^[a-f0-9]{32}$/.test(input.refundId)
    || !['APPROVE','REJECT'].includes(input.decision) || typeof input.evidenceReference !== 'string'
    || !input.evidenceReference.trim() || input.evidenceReference.length>255) throw Error('INVALID_REVIEW');
  return {...input};
}
function runReview(input,deployment,spawn=spawnSync) {
  return invokeOperator(reviewEvent(input),deployment,spawn);
}
function executionEvent(input) {
  if(!input||input.action!=='execute'||Object.keys(input).some(key=>!['action','refundId'].includes(key))
    ||typeof input.refundId!=='string'||!/^[a-f0-9]{32}$/.test(input.refundId))throw Error('INVALID_EXECUTION');
  return {...input};
}
function runExecution(input,deployment,spawn=spawnSync) {
  const fn=deployment?.functions?.find(item=>item.name===functionName);
  const config=JSON.parse(Buffer.from(fn?.envVariables?.PAYMENT_WECHAT_CONFIG_B64||'','base64').toString('utf8'));
  if(config.refundOperatorEnabled!==true||config.refundEnabled!==true)throw Error('REFUND_EXECUTION_DISABLED');
  return invokeOperator(executionEvent(input),deployment,spawn);
}
function invokeOperator(event,deployment,spawn) {
  const fn = deployment?.functions?.find(item=>item.name===functionName);
  const token = fn?.envVariables?.PAYMENT_REFUND_OPERATOR_TOKEN;
  if (deployment?.envId !== envId || fn?.handler !== 'index.refundOperator' || !/^[a-f0-9]{64}$/.test(token || '')) throw Error('OPERATOR_CONFIG_INVALID');
  const mode=['bankReserve','bankCancel'].includes(event.action)?'--private-bank':event.action==='execute'?'--private-execute':event.action==='review'?'--private-review':'--private-invoke';
  const child = spawn(process.execPath,[__filename,mode],{
    cwd:root,encoding:'utf8',timeout:60000,maxBuffer:262144,windowsHide:true,
    input:JSON.stringify({...event,operatorToken:token})
  });
  // Child stdout/stderr and exceptions may contain upstream details: never forward them.
  if (child.error || child.status !== 0) throw Error('OPERATOR_QUERY_FAILED');
  let result;
  try {
    const parsed = JSON.parse(child.stdout.slice(child.stdout.indexOf('{'),child.stdout.lastIndexOf('}')+1));
    if (parsed.data?.Result?.InvokeResult !== 0) throw Error();
    result = JSON.parse(parsed.data.Result.RetMsg);
  } catch { throw Error('OPERATOR_QUERY_FAILED'); }
  if (result?.ok !== true) throw Error('OPERATOR_QUERY_FAILED');
  return result.data;
}

async function main() {
  const [mode,file,...extra] = process.argv.slice(2);
  if (['--private-invoke','--private-review','--private-execute','--private-bank'].includes(mode) && !file) {
    let raw='';for await(const chunk of process.stdin) {raw+=chunk;if(raw.length>4096)throw Error('INVALID_QUERY');}
    const event=JSON.parse(raw),{operatorToken,...input}=event;
    if(mode==='--private-bank')bankMutationEvent(input);else if(mode==='--private-execute')executionEvent(input);else if(mode==='--private-review')reviewEvent(input);else queryEvent(input);
    if(typeof operatorToken !== 'string' || !/^[a-f0-9]{64}$/.test(operatorToken))throw Error('OPERATOR_CONFIG_INVALID');
    // Populate argv only in process memory. No secret is passed in the OS command line.
    process.argv=[process.execPath,path.join(__dirname,'cloudbase-company-cli.js'),'api','scf','Invoke',
      '--api-version','2018-04-16','--body',JSON.stringify({FunctionName:functionName,Namespace:envId,
        ClientContext:JSON.stringify(event),LogType:'None'}),'--json'];
    require('./cloudbase-company-cli');
    return;
  }
  if(!['--query','--bank','--export'].includes(mode) || !file || (mode==='--export'?extra.length!==1:extra.length!==0))throw Error('Use --query <query.json>, --bank <request.json>, or --export <bank-review.json> <output.csv>');
  const input=JSON.parse(fs.readFileSync(file,'utf8'));
  const deployment=JSON.parse(fs.readFileSync(path.join(root,'.cloudbase-cli-config/merchant-configured-closed/payment-refund-operator.json'),'utf8'));
  if(mode==='--export'){
    if(input.action!=='bankReview')throw Error('BANK_REVIEW_REQUIRED');
    const operator=deployment.functions.find(fn=>fn.name===functionName)?.envVariables?.BANK_BATCH_OPERATOR_ID;
    console.log(JSON.stringify(require('./bank-finance-export').writeFinanceCsv(runQuery(input,deployment),extra[0],operator)));return;
  }
  console.log(JSON.stringify(mode==='--bank'?runBankMutation(input,deployment):runQuery(input,deployment),null,2));
}
if(require.main===module)main().catch(()=>{console.error('退款管理查询未完成，请检查查询文件、管理配置和云端状态。');process.exitCode=1;});
module.exports={queryEvent,runQuery,reviewEvent,runReview,executionEvent,runExecution,bankMutationEvent,runBankMutation};
