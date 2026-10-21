// Reuse the signed notification handler. Preparation never opens payments or creates an HTTP route.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const privateDir = path.join(root, '.cloudbase-cli-config');
const deployment = JSON.parse(fs.readFileSync(path.join(privateDir, 'company-payment-closed-deploy.json')));
const original = deployment.functions?.find(fn => fn.name === 'payment-api');
if (deployment.envId !== 'cloudbase-d2g65rqbvee0bd978' || original?.handler !== 'index.main'
  || original.vpc?.vpcId !== 'vpc-fw6hzw6m' || original.publicNetConfig?.PublicNetStatus !== 'DISABLE') throw Error('NOTIFY_TARGET_INVALID');
const config = JSON.parse(Buffer.from(original.envVariables.PAYMENT_WECHAT_CONFIG_B64, 'base64').toString('utf8'));
if (config.appid !== 'wxc94e1c1b38944511' || config.paymentMode !== 'DIRECT'
  || ['prepayEnabled','closeEnabled','settlementEnabled','settlementExecutionEnabled','settlementPreparationEnabled','reconciliationEnabled'].some(key => config[key] !== false)
  || config.merchantPrivateKey || config.apiV3Key || config.publicKeys) throw Error('NOTIFY_REQUIRES_CLOSED_CONFIG');
const source = path.join(root, 'cloudfunctions/payment-api');
const functionRoot = '.artifacts/company-payment-notify-functions';
const folder = path.join(root, functionRoot, 'payment-notify');
const output = path.join(privateDir, 'company-payment-notify-closed-deploy.json');
for (const ignored of [folder, output]) execFileSync('git', ['check-ignore', '--quiet', ignored], { cwd: root });
fs.mkdirSync(folder, { recursive: true });
const files = fs.readdirSync(source).filter(name => name.endsWith('.js') && !name.endsWith('.test.js') && !name.startsWith('test-')
  || ['package.json','package-lock.json'].includes(name));
if (fs.readdirSync(folder).some(name => !files.includes(name) && name !== 'node_modules')) throw Error('NOTIFY_STAGING_REVIEW_REQUIRED');
for (const name of files) fs.copyFileSync(path.join(source, name), path.join(folder, name));
fs.cpSync(path.join(source, 'node_modules'), path.join(folder, 'node_modules'), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ envId: deployment.envId, functionRoot,
  functions: [{ ...original, name: 'payment-notify', handler: 'index.notify', timeout: 20, triggers: [] }] }, null, 2), { mode: 0o600 });
require('./company-deploy-preflight').preflight(['fn','deploy','payment-notify','--config-file',output,'--install-dependency','false'], root);
console.log(JSON.stringify({ prepared: true, function: 'payment-notify', handler: 'index.notify',
  privateDatabase: true, outgoingInternet: false, merchantCredentialsIncluded: false, deployed: false, routeCreated: false }));
