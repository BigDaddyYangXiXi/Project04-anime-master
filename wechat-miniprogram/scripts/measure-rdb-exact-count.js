// Temporary code-only diagnostic; restore the downloaded cloud baseline in finally.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),name='network-probe-public',env='cloudbase-d2g65rqbvee0bd978';
const baseline=path.join(root,'.artifacts/rdb-count-before-20261007',name),stageRoot=path.join(root,'.artifacts/rdb-count-stage-20261007'),stage=path.join(stageRoot,name);
const report={checkedAt:new Date().toISOString(),samples:[],restored:false};
function cli(args,timeout=90000){const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout});let j;try{j=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1));}catch{}if(r.status!==0||j?.error)throw Error('DIAGNOSTIC_CLI_FAILED');return j.data;}
const target={FunctionName:name,Namespace:env};
function api(action,body){return cli(['api','scf',action,'--api-version','2018-04-16','--body',JSON.stringify(body)]);}
function config(){return api('GetFunction',{...target,ShowCode:'FALSE'});}
const fields=['Runtime','Handler','Timeout','MemorySize','Environment','VpcConfig','Role','Layers','PublicNetConfig','Triggers'];
const digest=c=>crypto.createHash('sha256').update(JSON.stringify(fields.map(k=>[k,c[k]]))).digest('hex');
function active(expected){let c=config();for(let i=0;i<12&&['Updating','Creating','Deploying'].includes(c.Status);i++)c=config();if(c.Status!=='Active'||digest(c)!==expected)throw Error('DIAGNOSTIC_CONFIG_CHANGED');}
function update(dir){const cfg=path.join(stageRoot,'config.json'),c=JSON.parse(fs.readFileSync(cfg));c.functionRoot=path.dirname(dir);fs.writeFileSync(cfg,JSON.stringify(c));cli(['fn','code','update',name,'--dir',dir,'--config-file',cfg],240000);}
async function main(){
  if(require('../project.config.json').appid!=='wxc94e1c1b38944511')throw Error('APPID_MISMATCH');
  const before=config(),expected=digest(before),token=before.Environment?.Variables?.find(v=>v.Key==='NETWORK_PROBE_TOKEN')?.Value;
  if(before.Status!=='Active'||!/^[a-f0-9]{64}$/.test(token||''))throw Error('DIAGNOSTIC_GATE_INVALID');
  const original=fs.readFileSync(path.join(baseline,'index.js'),'utf8');
  const marker="  if (process.env.NETWORK_PROBE_MODE === 'public') {";
  if(!original.includes(marker)||original.includes('exactCountProbe')||!original.includes('timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))'))throw Error('DIAGNOSTIC_ENTRY_INVALID');
  if(require(path.join(baseline,'node_modules/@cloudbase/node-sdk/package.json')).version!=='3.18.3')throw Error('SDK_VERSION_MISMATCH');
  fs.cpSync(baseline,stage,{recursive:true});
  fs.copyFileSync(path.join(__dirname,'probes/rdb-exact-count.js'),path.join(stage,'rdb-exact-count.js'));
  fs.writeFileSync(path.join(stage,'index.js'),original.replace(marker,"  if (event.action === 'exactCountProbe') return require('./rdb-exact-count').rdbExactCount(require('@cloudbase/node-sdk'));\n"+marker));
  const cfg=path.join(stageRoot,'config.json');fs.writeFileSync(cfg,JSON.stringify({envId:env,functionRoot:stageRoot,functions:[{name,runtime:before.Runtime,handler:before.Handler,installDependency:false}]}));
  require('./company-deploy-preflight').preflight(['fn','deploy',name,'--config-file',cfg,'--install-dependency','false'],root);
  report.beforeConfigDigest=expected;
  if(process.argv.includes('--restore-only')) { update(baseline); active(expected); report.restored=true; report.configurationPreserved=true; return; }
  try {
    update(stage);active(expected);console.log('受保护的只读计数诊断已就绪。');
    const denied=api('Invoke',{...target,ClientContext:JSON.stringify({action:'exactCountProbe'}),LogType:'None'});
    report.noTokenRejected=JSON.parse(denied.Result.RetMsg).code==='FORBIDDEN';
    if(!report.noTokenRejected)throw Error('DIAGNOSTIC_GATE_FAILED');
    const invoked=api('Invoke',{...target,ClientContext:JSON.stringify({action:'exactCountProbe',token}),LogType:'None'});
    const value=JSON.parse(invoked.Result.RetMsg);
    report.result=value;report.durationMs=invoked.Result.Duration;console.log(JSON.stringify({result:value,durationMs:report.durationMs}));
  } finally {
    update(baseline);active(expected);report.restored=true;report.configurationPreserved=true;
    console.log('诊断函数原代码和配置已恢复。');
  }
}
main().catch(e=>{report.error=e.message;console.error(e.message);process.exitCode=1;}).finally(()=>fs.writeFileSync(path.join(root,process.argv.includes('--restore-only')?'.artifacts/rdb-count-restore-repair.json':'.artifacts/rdb-exact-count-cloud.json'),JSON.stringify(report,null,2)));
