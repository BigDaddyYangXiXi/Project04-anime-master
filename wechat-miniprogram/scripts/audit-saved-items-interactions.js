// Read configuration, downloaded code and anonymous rejection only. No user mutation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),name='saved-items-api',target={FunctionName:name,Namespace:'cloudbase-d2g65rqbvee0bd978'};
function api(action,body){const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),'api','scf',action,'--api-version','2018-04-16','--body',JSON.stringify(body),'--json'],{cwd:root,encoding:'utf8',timeout:60000});if(r.status!==0)throw Error('READ_FAILED');return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1)).data;}
function manifest(dir,relative=''){return fs.readdirSync(path.join(dir,relative),{withFileTypes:true}).flatMap(e=>{const p=path.join(relative,e.name);return e.isDirectory()?manifest(dir,p):[[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,p))).digest('hex')]]});}
try{
 const c=api('GetFunction',{...target,ShowCode:'FALSE'}),before=JSON.parse(fs.readFileSync(path.join(root,'.artifacts/saved-items-api-pagination-config-before.json')));
 const changed=Object.keys(before.fields).filter(k=>crypto.createHash('sha256').update(JSON.stringify(c[k])||'undefined').digest('hex')!==before.fields[k]);
 const a=new Map(manifest(path.join(root,'.artifacts/saved-items-stage-20261008',name))),b=new Map(manifest(path.join(root,'.artifacts/saved-items-after-20261008',name)));
 const differences=[...new Set([...a.keys(),...b.keys()])].filter(k=>a.get(k)!==b.get(k));
 const report={checkedAt:new Date().toISOString(),status:c.Status,changedFields:changed,configurationPreserved:!changed.length,packageFiles:a.size,readbackFiles:b.size,differences,anonymousRejected:false,positiveUserFlowVerified:false};
 if(c.Status==='Active'&&!changed.length&&!differences.length){const r=api('Invoke',{...target,ClientContext:JSON.stringify({action:'listReceived',type:'followers'}),LogType:'None'});report.anonymousRejected=JSON.parse(r.Result.RetMsg)?.error?.code==='AUTH_CONTEXT_MISSING';}
 fs.writeFileSync(path.join(root,'.artifacts/saved-items-pagination-readback.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(c.Status!=='Active'||changed.length||differences.length||!report.anonymousRejected)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
