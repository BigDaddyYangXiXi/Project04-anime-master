// Operator-only deployment/empty-queue check. No test refunds are created.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),name='payment-query-worker',envId='cloudbase-d2g65rqbvee0bd978';
function cli(args){
  const run=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout:60000});
  let parsed;try{parsed=JSON.parse(run.stdout.slice(run.stdout.indexOf('{'),run.stdout.lastIndexOf('}')+1));}catch{}
  if(run.status!==0||!parsed?.data||parsed.error)throw Error('CLOUD_AUDIT_FAILED');return parsed.data;
}
try {
  const expected=JSON.parse(fs.readFileSync(path.join(root,'.cloudbase-cli-config/merchant-configured-closed/payment-query-worker.json'),'utf8'));
  const [fn]=expected.functions;assert.equal(expected.envId,envId);assert.equal(fn.name,name);
  const current=cli(['api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ShowCode:'FALSE'})]);
  const env=Object.fromEntries(current.Environment.Variables.map(item=>[item.Key,item.Value]));
  assert.equal(current.Status,'Active');assert.equal(current.Handler,'index.paymentReconcile');
  assert.deepEqual(env,fn.envVariables);
  if (process.argv.includes('--scheduled')) {
    assert.equal(current.Triggers.length,1);
    const [timer]=current.Triggers;
    assert.equal(timer.TriggerName,'payment-reconcile-every-five-minutes');assert.equal(timer.Type,'timer');assert.equal(timer.Enable,1);
    assert.equal(JSON.parse(timer.TriggerDesc).cron,'0 */5 * * * * *');
    assert.deepEqual(JSON.parse(timer.CustomArgument),{workerToken:env.PAYMENT_QUERY_WORKER_TOKEN});
  } else assert.deepEqual(current.Triggers,[]);
  assert.equal(current.VpcConfig.VpcId,'vpc-fw6hzw6m');assert.equal(current.PublicNetConfig.PublicNetStatus,'DISABLE');
  const config=JSON.parse(Buffer.from(env.PAYMENT_WECHAT_CONFIG_B64,'base64'));
  assert.equal(config.reconciliationEnabled,true);assert.equal(config.closeEnabled,false);assert.equal(config.refundEnabled,false);assert.equal(config.refundRequestsEnabled,false);
  const invoke=event=>cli(['api','scf','Invoke','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ClientContext:JSON.stringify(event),LogType:'None'})]);
  const rejected=JSON.parse(invoke({}).Result.RetMsg);assert.equal(rejected.error.code,'PAYMENT_WORKER_FORBIDDEN');
  const counts=cli(['db','execute','--read-only','--sql','SELECT DATABASE() AS db, (SELECT COUNT(*) FROM order_payments) AS payments']);
  assert.equal(counts.items[0].db,envId);assert.equal(Number(counts.items[0].payments),0);
  const timerEvent=process.argv.includes('--timer-event');
  const request={workerToken:env.PAYMENT_QUERY_WORKER_TOKEN};
  const accepted=invoke(timerEvent ? {Type:'Timer',TriggerName:'payment-reconcile-every-five-minutes',Time:new Date().toISOString(),Message:JSON.stringify(request)} : request);const result=JSON.parse(accepted.Result.RetMsg);
  assert.equal(result.ok,true);assert.deepEqual(result.data,{enabled:true,examined:0,queried:0,skipped:0,failed:0});
  const report={checkedAt:new Date().toISOString(),ok:true,configurationMatched:true,missingTokenRejected:true,timerEventValidated:timerEvent,emptyQueue:result.data,requestId:accepted.RequestId,
    scope:'Live restricted database scan of an empty queue; manual invocation only, not proof of automatic scheduling or actual channel results.'};
  fs.writeFileSync(path.join(root,'.artifacts/company-payment-worker-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch {console.error('PAYMENT_WORKER_AUDIT_FAILED');process.exitCode=1;}
