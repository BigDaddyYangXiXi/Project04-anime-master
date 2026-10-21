// First deployment is query-only; no payment keys or mutation switches are copied.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),privateDir=path.join(root,'.cloudbase-cli-config/merchant-configured-closed');
const original=JSON.parse(fs.readFileSync(path.join(privateDir,'payment-api.json'),'utf8'));
const fn=original.functions?.find(item=>item.name==='payment-api');
if(original.envId!=='cloudbase-d2g65rqbvee0bd978'||fn?.handler!=='index.main'||fn.vpc?.vpcId!=='vpc-fw6hzw6m'
  ||fn.publicNetConfig?.PublicNetStatus!=='DISABLE')throw Error('OPERATOR_TARGET_INVALID');
const sourceConfig=JSON.parse(Buffer.from(fn.envVariables.PAYMENT_WECHAT_CONFIG_B64,'base64'));
if(sourceConfig.appid!=='wxc94e1c1b38944511'||sourceConfig.platformMchid!=='1750932981'||sourceConfig.paymentMode!=='DIRECT')throw Error('OPERATOR_MERCHANT_INVALID');
const config={appid:sourceConfig.appid,platformMchid:sourceConfig.platformMchid,paymentMode:'DIRECT',refundOperatorEnabled:true,
  refundReviewEnabled:false,refundEnabled:false,refundRequestsEnabled:false,refundReconciliationEnabled:false,
  prepayEnabled:false,closeEnabled:false,settlementEnabled:false,settlementExecutionEnabled:false,settlementPreparationEnabled:false,reconciliationEnabled:false};
const name='payment-refund-operator',functionRoot='.artifacts/company-refund-operator-functions';
const folder=path.join(root,functionRoot,name),output=path.join(privateDir,name+'.json');
for(const target of [folder,output])execFileSync('git',['-c',`safe.directory=${path.dirname(root).replaceAll('\\','/')}`,'check-ignore','--quiet',target],{cwd:root});
if(fs.existsSync(output))throw Error('OPERATOR_CONFIG_ALREADY_EXISTS');
fs.mkdirSync(folder,{recursive:true});
const source=path.join(root,'cloudfunctions/payment-api');
for(const file of fs.readdirSync(source).filter(file=>file.endsWith('.js')&&!file.endsWith('.test.js')&&!file.startsWith('test-')||['package.json','package-lock.json'].includes(file)))fs.copyFileSync(path.join(source,file),path.join(folder,file));
fs.cpSync(path.join(source,'node_modules'),path.join(folder,'node_modules'),{recursive:true});
if(!fn.envVariables.PAYMENT_MYSQL_CONFIG_B64)throw Error('OPERATOR_DATABASE_CONFIG_MISSING');
const envVariables={PAYMENT_MYSQL_CONFIG_B64:fn.envVariables.PAYMENT_MYSQL_CONFIG_B64,
  PAYMENT_WECHAT_CONFIG_B64:Buffer.from(JSON.stringify(config)).toString('base64'),
  PAYMENT_REFUND_OPERATOR_TOKEN:crypto.randomBytes(32).toString('hex'),
  // Technical query identity only. Must replace with an accountable reviewer before enabling review.
  PAYMENT_REFUND_REVIEWER_ID:'refund_query_service'};
fs.writeFileSync(output,JSON.stringify({envId:original.envId,functionRoot,functions:[{...fn,name,handler:'index.refundOperator',envVariables,triggers:[]}]},null,2),{flag:'wx',mode:0o600});
require('./company-deploy-preflight').preflight(['fn','deploy',name,'--config-file',output,'--install-dependency','false'],root);
console.log(JSON.stringify({prepared:true,queryOnly:true,paymentKeysIncluded:false,deployed:false}));
