// Reuse current company notification credentials; never generates new keys or enables refunds.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const privateDir = path.join(root, '.cloudbase-cli-config/merchant-configured-closed');
const original = JSON.parse(fs.readFileSync(path.join(privateDir, 'payment-notify.json'), 'utf8'));
const sourceFunction = original.functions?.find(fn => fn.name === 'payment-notify');
if (original.envId !== 'cloudbase-d2g65rqbvee0bd978' || sourceFunction?.handler !== 'index.notify'
  || sourceFunction.vpc?.vpcId !== 'vpc-fw6hzw6m' || sourceFunction.publicNetConfig?.PublicNetStatus !== 'DISABLE') throw Error('REFUND_NOTIFY_CONFIG_MISMATCH');
const config = JSON.parse(Buffer.from(sourceFunction.envVariables.PAYMENT_WECHAT_CONFIG_B64, 'base64').toString('utf8'));
if (config.appid !== 'wxc94e1c1b38944511' || config.platformMchid !== '1750932981' || config.paymentMode !== 'DIRECT'
  || ['prepayEnabled','closeEnabled','settlementEnabled','settlementExecutionEnabled','settlementPreparationEnabled','reconciliationEnabled'].some(key => config[key] !== false)
  || ['refundRequestsEnabled','refundEnabled','refundReconciliationEnabled'].some(key => config[key] === true)) throw Error('REFUND_NOTIFY_REQUIRES_CLOSED_CONFIG');
const functionRoot = '.artifacts/company-refund-notify-functions';
const folder = path.join(root, functionRoot, 'payment-refund-notify');
const output = path.join(privateDir, 'payment-refund-notify.json');
for (const target of [folder, output]) execFileSync('git', ['-c', `safe.directory=${path.dirname(root).replaceAll('\\','/')}`, 'check-ignore', '--quiet', target], {cwd:root});
if (fs.existsSync(output)) throw Error('REFUND_NOTIFY_CONFIG_ALREADY_EXISTS');
fs.mkdirSync(folder, {recursive:true});
const source = path.join(root, 'cloudfunctions/payment-api');
for (const name of fs.readdirSync(source).filter(name => name.endsWith('.js') && !name.endsWith('.test.js') && !name.startsWith('test-')
  || ['package.json','package-lock.json'].includes(name))) fs.copyFileSync(path.join(source,name),path.join(folder,name));
fs.cpSync(path.join(source,'node_modules'),path.join(folder,'node_modules'),{recursive:true});
fs.writeFileSync(output,JSON.stringify({envId:original.envId,functionRoot,functions:[{...sourceFunction,name:'payment-refund-notify',handler:'index.refundNotify',triggers:[]}]},null,2),{flag:'wx',mode:0o600});
require('./company-deploy-preflight').preflight(['fn','deploy','payment-refund-notify','--config-file',output,'--install-dependency','false'],root);
console.log(JSON.stringify({prepared:true,function:'payment-refund-notify',handler:'index.refundNotify',deployed:false,refundEnabled:false}));
