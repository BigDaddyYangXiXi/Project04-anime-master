// Read-only deployment and unauthenticated rejection checks; never sends a probe token.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),envId='cloudbase-d2g65rqbvee0bd978';
function query(args){
 const run=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout:60000});
 let parsed;try{parsed=JSON.parse(run.stdout.slice(run.stdout.indexOf('{'),run.stdout.lastIndexOf('}')+1));}catch{}
 if(run.status!==0||!parsed?.data||parsed.error)throw Error('NETWORK_PROBE_AUDIT_QUERY_FAILED');
 return parsed.data;
}
try{
 const services=query(['service','list']);if(!Array.isArray(services))throw Error('SERVICE_LIST_INVALID');
 const checks=[];
 for(const name of ['network-probe','network-probe-public']){
  const current=query(['api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ShowCode:'FALSE'})]);
  const env=Object.fromEntries((current.Environment?.Variables||[]).map(item=>[item.Key,item.Value]));
  const invoked=query(['api','scf','Invoke','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ClientContext:'{}',LogType:'None'})]);
  const result=JSON.parse(invoked.Result.RetMsg);
  checks.push({name,status:current.Status,runtime:current.Runtime,
   noTriggers:Array.isArray(current.Triggers)&&current.Triggers.length===0,
   noHttpRoute:services.every(service=>service.name!==name),
   validTokenConfigured:typeof env.NETWORK_PROBE_TOKEN==='string'&&/^[a-f0-9]{64}$/.test(env.NETWORK_PROBE_TOKEN),
   onlyDiagnosticEnvironment:Object.keys(env).every(key=>['NETWORK_PROBE_TOKEN','NETWORK_PROBE_MODE'].includes(key)),
   modeMatched:name==='network-probe-public'?env.NETWORK_PROBE_MODE==='public':!env.NETWORK_PROBE_MODE,
   missingTokenRejected:invoked.Result.InvokeResult===0&&result.ok===false&&result.code==='FORBIDDEN'});
 }
 const report={checkedAt:new Date().toISOString(),checks,ok:checks.every(c=>c.status==='Active'&&c.noTriggers&&c.noHttpRoute&&c.validTokenConfigured&&c.onlyDiagnosticEnvironment&&c.modeMatched&&c.missingTokenRejected),
  scope:'Configuration and missing-token rejection only. No authorized network probe, SQL, money operation or deletion. Does not prove absence of external callers.'};
 fs.writeFileSync(path.join(root,'.artifacts/company-network-probe-audit.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
}catch{console.error('NETWORK_PROBE_AUDIT_FAILED');process.exitCode=1;}
