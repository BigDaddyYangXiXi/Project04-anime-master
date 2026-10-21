// Narrow code-only update from the downloaded production baseline. No timer invocation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),env='cloudbase-d2g65rqbvee0bd978';
const changes={'catalog-read':['catalog-core.js'],'provider-catalog-draft':['draft-core.js','publication-core.js']};
const name=process.argv[2];if(!changes[name])throw Error('EXPLICIT_IMAGE_EDIT_FUNCTION_REQUIRED');
if(require('../cloudbaserc.json').envId!==env||require('../project.config.json').appid!=='wxc94e1c1b38944511')throw Error('TARGET_MISMATCH');
function cli(args,timeout=60000){const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout});let j;try{j=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1));}catch(_){}if(r.status!==0||j?.error)throw Error('CLI_OPERATION_FAILED');return j?.data;}
function config(){return cli(['api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:env,ShowCode:'FALSE'})]);}
const fields=['Runtime','Handler','Timeout','MemorySize','Environment','VpcConfig','Role','Layers','PublicNetConfig','Triggers'];
function configDigest(c){return crypto.createHash('sha256').update(JSON.stringify(fields.map(k=>[k,c[k]]))).digest('hex');}
try{
 const before=config();if(before.Status!=='Active')throw Error('FUNCTION_NOT_ACTIVE');
 const beforeHashes=Object.fromEntries(fields.map(k=>[k,crypto.createHash('sha256').update(JSON.stringify(before[k])||'undefined').digest('hex')]));
 fs.writeFileSync(path.join(root,'.artifacts',name+'-image-edit-config-before.json'),JSON.stringify({checkedAt:new Date().toISOString(),status:before.Status,fields:beforeHashes},null,2));
 const source=path.join(root,'cloudfunctions',name),baseline=path.join(root,'.artifacts/image-edit-baseline-20261008',name),stageRoot=path.join(root,'.artifacts/image-edit-stage-20261008'),stage=path.join(stageRoot,name);
 for(const file of fs.readdirSync(source).filter(f=>f.endsWith('.js')&&!f.endsWith('.test.js')||['package.json','package-lock.json'].includes(f))){if(!changes[name].includes(file)&&!fs.readFileSync(path.join(source,file)).equals(fs.readFileSync(path.join(baseline,file)))) {
  const preservedVendorEntry = name === 'catalog-read' && file === 'index.js' && fs.readFileSync(path.join(baseline,file),'utf8').replace('require("./vendor/dist/utils/cloudbase.cjs")','require("@cloudbase/node-sdk")').replaceAll('\r\n','\n') === fs.readFileSync(path.join(source,file),'utf8').replaceAll('\r\n','\n');
  if(!preservedVendorEntry)throw Error('UNRELATED_CODE_DRIFT');
 }}
 fs.cpSync(baseline,stage,{recursive:true});for(const file of changes[name])fs.copyFileSync(path.join(source,file),path.join(stage,file));
 const cfg=path.join(stageRoot,name+'.json');fs.writeFileSync(cfg,JSON.stringify({envId:env,functionRoot:stageRoot,functions:[{name,runtime:before.Runtime,handler:before.Handler,installDependency:false}]}));
 require('./company-deploy-preflight').preflight(['fn','deploy',name,'--config-file',cfg,'--install-dependency','false'],root);
 console.log(JSON.stringify({phase:'prepared',name,changedFiles:changes[name]}));
 if(process.argv.includes('--prepare-only'))process.exit(0);
 cli(['fn','code','update',name,'--dir',stage,'--config-file',cfg],240000);
 let after=config();
 for(let attempt=0;attempt<12&&['Updating','Creating','Deploying'].includes(after.Status);attempt++) after=config();
 const changed=fields.filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
 if(after.Status!=='Active'||configDigest(before)!==configDigest(after)) { fs.writeFileSync(path.join(root,'.artifacts',name+'-image-edit-config-failure.json'),JSON.stringify({checkedAt:new Date().toISOString(),status:after.Status,changedFields:changed},null,2)); throw Error('POST_DEPLOY_CONFIG_MISMATCH'); }
 const report={checkedAt:new Date().toISOString(),name,changedFile:changes[name],status:after.Status,configurationPreserved:true,sourceHashes:Object.fromEntries(changes[name].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(stage,file))).digest('hex')])),readbackVerified:false,businessMutationInvoked:false};
 const readback=path.join(root,'.artifacts/image-edit-readback-20261008',name);fs.mkdirSync(readback,{recursive:true});cli(['fn','code','download',name,readback],120000);
 for(const file of changes[name])if(!fs.readFileSync(path.join(readback,file)).equals(fs.readFileSync(path.join(stage,file))))throw Error('DEPLOYMENT_READBACK_MISMATCH');
 report.readbackVerified=true;
 fs.writeFileSync(path.join(root,'.artifacts',name+'-image-edit-deployment.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(e){console.error(e.code||e.message);process.exitCode=1;}
