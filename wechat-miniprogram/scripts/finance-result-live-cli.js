const fs=require('node:fs'),path=require('node:path');
const {runQuery}=require('./refund-operator-console');
const {reviewLiveFinanceResult}=require('./finance-result-live-review');
async function main(argv=process.argv.slice(2),deps={}){
  if(argv.length!==3||argv[0]!=='--review')throw Error('FINANCE_LIVE_ARGUMENTS_INVALID');
  const read=deps.readFileSync||fs.readFileSync;
  const deployment=JSON.parse(read(path.join(__dirname,'../.cloudbase-cli-config/merchant-configured-closed/payment-refund-operator.json'),'utf8'));
  const operator=deployment.functions?.find(fn=>fn.name==='payment-refund-operator')?.envVariables?.BANK_BATCH_OPERATOR_ID;
  if(deployment.envId!=='cloudbase-d2g65rqbvee0bd978'||!/^[A-Za-z0-9_-]{1,64}$/.test(operator||''))throw Error('FINANCE_LIVE_CONFIG_INVALID');
  const input=JSON.parse(read(argv[1],'utf8'));
  const result=await reviewLiveFinanceResult(null,{appid:'wxc94e1c1b38944511',platformMchid:'1750932981'},input,operator,
    (_pool,batchId)=>(deps.runQuery||runQuery)({action:'bankReview',batchId},deployment));
  (deps.writeFileSync||fs.writeFileSync)(argv[2],JSON.stringify({...result,checkedAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
  return {status:result.status,records:result.records.length,payable:false};
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(()=>{
  console.error('FINANCE_LIVE_REVIEW_FAILED');process.exitCode=1;
});
module.exports={main};
