// Read-only metrics; never invokes the worker, so it cannot fabricate scheduling evidence.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
try {
 const manual=JSON.parse(fs.readFileSync(path.join(root,'.artifacts/company-payment-worker-audit.json')));
 const created=JSON.parse(fs.readFileSync(path.join(root,'.artifacts/payment-worker-timer-created.json')));
 const baseline=Math.max(Date.parse(manual.checkedAt),Date.parse(created.createdAt));
 if(!Number.isFinite(baseline))throw Error();
 const firstScheduled=(Math.floor(baseline/300000)+1)*300000;
 if(Date.now()<firstScheduled+60000){console.log(JSON.stringify({ready:false,firstScheduledAt:new Date(firstScheduled).toISOString(),reason:'WAIT_FOR_COMPLETE_SCHEDULED_MINUTE'}));process.exit(0);}
 const metrics=[];
 for(const MetricName of ['Invocation','Error','Duration']){
  const body={Namespace:'QCE/SCF_V2',MetricName,Period:60,
   StartTime:new Date(firstScheduled).toISOString(),EndTime:new Date().toISOString(),
   Instances:[{Dimensions:[{Name:'functionName',Value:'payment-query-worker'},{Name:'namespace',Value:'cloudbase-d2g65rqbvee0bd978'},{Name:'version',Value:'$LATEST'}]}]};
  const run=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),'api','monitor','GetMonitorData','--api-version','2018-07-24','--body',JSON.stringify(body),'--json'],{cwd:root,encoding:'utf8',timeout:60000});
  const parsed=JSON.parse(run.stdout.slice(run.stdout.indexOf('{'),run.stdout.lastIndexOf('}')+1));
  if(run.status!==0||!parsed.data||parsed.error)throw Error();metrics.push(parsed.data);
 }
 const report={checkedAt:new Date().toISOString(),firstScheduledAt:new Date(firstScheduled).toISOString(),lastRecordedManualAt:manual.checkedAt,metrics,
  scope:'Metrics after the recorded manual invocation; confirm no other manual calls. Not evidence of a real paid transaction or arrival.'};
 fs.writeFileSync(path.join(root,'.artifacts/payment-worker-scheduled-metrics.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}catch{console.error('PAYMENT_WORKER_METRICS_FAILED');process.exitCode=1;}
