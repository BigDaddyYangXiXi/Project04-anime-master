// Separate query-only worker. No refund submission switch or timer is enabled.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),privateDir=path.join(root,'.cloudbase-cli-config/merchant-configured-closed');
const original=JSON.parse(fs.readFileSync(path.join(privateDir,'payment-api.json'),'utf8'));
const fn=original.functions?.find(item=>item.name==='payment-api');
if(original.envId!=='cloudbase-d2g65rqbvee0bd978'||fn?.handler!=='index.main'||fn.vpc?.vpcId!=='vpc-fw6hzw6m'
  ||fn.publicNetConfig?.PublicNetStatus!=='DISABLE')throw Error('WORKER_TARGET_INVALID');
const config=JSON.parse(Buffer.from(fn.envVariables.PAYMENT_WECHAT_CONFIG_B64,'base64'));
if(config.platformMchid!=='1750932981'||config.appid!=='wxc94e1c1b38944511'||config.paymentMode!=='DIRECT'
  ||['prepayEnabled','closeEnabled','settlementEnabled','settlementExecutionEnabled','settlementPreparationEnabled','reconciliationEnabled'].some(key=>config[key]!==false)
  ||['refundEnabled','refundRequestsEnabled'].some(key=>config[key]===true))throw Error('WORKER_REQUIRES_CLOSED_MONEY_CONFIG');
const functionRoot='.artifacts/company-refund-worker-functions',name='payment-refund-worker';
const folder=path.join(root,functionRoot,name),output=path.join(privateDir,name+'.json');
for(const target of [folder,output])execFileSync('git',['-c',`safe.directory=${path.dirname(root).replaceAll('\\','/')}`,'check-ignore','--quiet',target],{cwd:root});
if(fs.existsSync(output))throw Error('WORKER_CONFIG_ALREADY_EXISTS');
fs.mkdirSync(folder,{recursive:true});
const source=path.join(root,'cloudfunctions/payment-api');
for(const file of fs.readdirSync(source).filter(file=>file.endsWith('.js')&&!file.endsWith('.test.js')&&!file.startsWith('test-')||['package.json','package-lock.json'].includes(file)))fs.copyFileSync(path.join(source,file),path.join(folder,file));
fs.cpSync(path.join(source,'node_modules'),path.join(folder,'node_modules'),{recursive:true});
config.refundReconciliationEnabled=true;
config.refundEnabled=false;
config.refundRequestsEnabled=false;
const envVariables={...fn.envVariables,PAYMENT_WECHAT_CONFIG_B64:Buffer.from(JSON.stringify(config)).toString('base64'),PAYMENT_REFUND_WORKER_TOKEN:crypto.randomBytes(32).toString('hex')};
fs.writeFileSync(output,JSON.stringify({envId:original.envId,functionRoot,functions:[{...fn,name,handler:'index.refundReconcile',envVariables,triggers:[]}]},null,2),{flag:'wx',mode:0o600});
require('./company-deploy-preflight').preflight(['fn','deploy',name,'--config-file',output,'--install-dependency','false'],root);
console.log(JSON.stringify({prepared:true,name,queryEnabled:true,refundSubmissionEnabled:false,timerEnabled:false,deployed:false}));
