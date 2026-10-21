// Invoke only the fixed, rollback-only permission probe. Never print credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
try {
  const config=JSON.parse(fs.readFileSync(path.join(root,'.cloudbase-cli-config/tax-permission-probe.json'),'utf8'));
  assert.equal(config.envId,'cloudbase-d2g65rqbvee0bd978');
  const fn=config.functions.find(f=>f.name==='tax-permission-probe');
  const body={FunctionName:fn.name,Namespace:config.envId,LogType:'None',ClientContext:JSON.stringify({token:fn.envVariables.TAX_PERMISSION_PROBE_TOKEN})};
  const result=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),'api','scf','Invoke','--api-version','2018-04-16','--body',JSON.stringify(body),'--json'],{cwd:root,encoding:'utf8',timeout:60000});
  assert.equal(result.status,0);
  const response=JSON.parse(result.stdout.slice(result.stdout.indexOf('{'),result.stdout.lastIndexOf('}')+1));
  const value=JSON.parse(response.data.Result.RetMsg);
  assert.deepEqual(value,{ok:true,actorMatched:true,insertAndIdempotentRetry:true,profileRead:true,privatePayloadUpdateDenied:true,deleteDenied:true,reviewUpdateDenied:true,otherTaxTablesDenied:true,rolledBack:true,remaining:0});
  const report={checkedAt:new Date().toISOString(),...value,scope:'Synthetic transaction with production am_payment; all writes rolled back. No real identity or money actions.'};
  fs.writeFileSync(path.join(root,'.artifacts/tax-live-permission-probe-2026-09-27.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch { console.error('TAX_LIVE_PERMISSION_AUDIT_FAILED'); process.exitCode=1; }
