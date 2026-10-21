// Read-only deployed configuration and unauthenticated read rejection; no user identity injection.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),envId='cloudbase-d2g65rqbvee0bd978';
function cli(args){const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout:60000});let j;try{j=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1));}catch(_){}if(r.status!==0||!j?.data||j.error)throw Error('READ_ONLY_AUDIT_FAILED');return j.data;}
try{
 const expected=require('../cloudbaserc.json').functions.find(f=>f.name==='support-api');
 const current=cli(['api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:'support-api',Namespace:envId,ShowCode:'FALSE'})]);
 assert.equal(current.Status,'Active');assert.equal(current.Runtime,expected.runtime);assert.equal(current.Handler,expected.handler);assert.equal(current.Timeout,expected.timeout);
 assert.equal((current.Environment?.Variables||[]).length,0);
 const invocation=cli(['fn','invoke','support-api','-d',JSON.stringify({action:'list'} )]);const response=JSON.parse(invocation.RetMsg);
 assert.equal(response.ok,false);assert.equal(response.error?.code,'AUTH_CONTEXT_MISSING');
 const report={checkedAt:new Date().toISOString(),name:'support-api',status:current.Status,runtime:current.Runtime,handler:current.Handler,timeout:current.Timeout,memory:current.MemorySize,environmentVariables:0,anonymousReadRejected:true,authenticatedFlowVerified:false,sourceHashVerified:false};
 fs.writeFileSync(path.join(root,'.artifacts/support-deployment-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){console.error(e.code||e.message);process.exitCode=1;}
