const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),name='tax-permission-probe';
const original=JSON.parse(fs.readFileSync(path.join(root,'.cloudbase-cli-config/merchant-configured-closed/payment-api.json'),'utf8'));
const fn=original.functions.find(f=>f.name==='payment-api');
if(original.envId!=='cloudbase-d2g65rqbvee0bd978'||fn.vpc?.vpcId!=='vpc-fw6hzw6m'||fn.publicNetConfig?.PublicNetStatus!=='DISABLE')throw Error('PROBE_TARGET_INVALID');
const functionRoot='.artifacts/tax-permission-probe-functions',folder=path.join(root,functionRoot,name);
const output=path.join(root,'.cloudbase-cli-config/tax-permission-probe.json');
for(const target of [folder,output])execFileSync('git',['-c',`safe.directory=${path.dirname(root).replaceAll('\\','/')}`,'check-ignore','--quiet',target],{cwd:root});
if(fs.existsSync(output))throw Error('EXISTING_PROBE_REQUIRES_REVIEW');
fs.mkdirSync(folder,{recursive:true});
fs.copyFileSync(path.join(__dirname,'probes/tax-permission-probe.js'),path.join(folder,'index.js'));
const source=path.join(root,'cloudfunctions/payment-api');
for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(source,file),path.join(folder,file));
fs.cpSync(path.join(source,'node_modules'),path.join(folder,'node_modules'),{recursive:true});
const envVariables={PAYMENT_MYSQL_CONFIG_B64:fn.envVariables.PAYMENT_MYSQL_CONFIG_B64,TAX_PERMISSION_PROBE_TOKEN:crypto.randomBytes(32).toString('hex')};
fs.writeFileSync(output,JSON.stringify({envId:original.envId,functionRoot,functions:[{name,handler:'index.main',runtime:'Nodejs20.19',timeout:30,memorySize:256,
  vpc:fn.vpc,publicNetConfig:fn.publicNetConfig,envVariables,triggers:[]}]},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({prepared:true,name,containsMerchantKeys:false,transactionRollback:true}));
