const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {runQuery}=require('./refund-operator-console');
const root=path.resolve(__dirname,'..'),name='payment-refund-operator',envId='cloudbase-d2g65rqbvee0bd978';
function cli(args) {
  const run=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout:60000,windowsHide:true});
  let parsed;try{parsed=JSON.parse(run.stdout.slice(run.stdout.indexOf('{'),run.stdout.lastIndexOf('}')+1));}catch{}
  if(run.status!==0||!parsed?.data||parsed.error)throw Error('OPERATOR_AUDIT_FAILED');return parsed.data;
}
try {
  const expected=JSON.parse(fs.readFileSync(path.join(root,'.cloudbase-cli-config/merchant-configured-closed/payment-refund-operator.json'),'utf8'));
  assert.equal(expected.envId,envId);const [fn]=expected.functions;assert.equal(fn.name,name);
  const current=cli(['api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ShowCode:'FALSE'})]);
  const env=Object.fromEntries(current.Environment.Variables.map(item=>[item.Key,item.Value]));
  assert.equal(current.Status,'Active');assert.equal(current.Handler,'index.refundOperator');assert.deepEqual(env,fn.envVariables);
  assert.deepEqual(current.Triggers,[]);assert.equal(current.VpcConfig.VpcId,'vpc-fw6hzw6m');assert.equal(current.PublicNetConfig.PublicNetStatus,'DISABLE');
  const config=JSON.parse(Buffer.from(env.PAYMENT_WECHAT_CONFIG_B64,'base64'));
  assert.deepEqual(Object.keys(config).sort(),['appid','platformMchid','paymentMode','refundOperatorEnabled','refundReviewEnabled','refundEnabled',
    'refundRequestsEnabled','refundReconciliationEnabled','prepayEnabled','closeEnabled','settlementEnabled','settlementExecutionEnabled','settlementPreparationEnabled','reconciliationEnabled'].sort());
  assert.equal(config.refundOperatorEnabled,true);assert.equal(config.appid,'wxc94e1c1b38944511');assert.equal(config.platformMchid,'1750932981');assert.equal(config.paymentMode,'DIRECT');
  for(const key of Object.keys(config).filter(key=>key.endsWith('Enabled')&&key!=='refundOperatorEnabled'))assert.equal(config[key],false);
  const rejected=cli(['api','scf','Invoke','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ClientContext:'{}',LogType:'None'})]);
  assert.equal(JSON.parse(rejected.Result.RetMsg).error.code,'REFUND_OPERATOR_FORBIDDEN');
  const result=runQuery({action:'list',status:'REQUESTED'},expected);
  assert.ok(Array.isArray(result.records));assert.ok(result.records.length<=20);
  const reviews=runQuery({action:'paymentReviews'},expected);
  assert.ok(Array.isArray(reviews.records));assert.ok(reviews.records.length<=20);
  const report={checkedAt:new Date().toISOString(),ok:true,configurationMatched:true,paymentKeysIncluded:false,
    reviewEnabled:false,refundEnabled:false,anonymousRejected:true,requestedCount:result.records.length,paymentReviewCount:reviews.records.length,
    scope:'Live read-only query; no approval, refund submission or actual refund arrival verified.'};
  fs.writeFileSync(path.join(root,'.artifacts/company-refund-operator-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch {console.error('REFUND_OPERATOR_AUDIT_FAILED');process.exitCode=1;}
