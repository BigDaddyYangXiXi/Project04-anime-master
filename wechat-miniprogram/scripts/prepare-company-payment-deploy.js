// Prepare a closed payment service using the existing company private database account.
// No merchant material is invented and no upload, HTTP route or payment is performed here.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const envId = 'cloudbase-d2g65rqbvee0bd978';
const privateDir = path.join(root, '.cloudbase-cli-config');
const accounts = JSON.parse(fs.readFileSync(path.join(privateDir, 'company-database-accounts.json')));
const database = accounts.am_payment;
if (!database || database.user !== 'am_payment' || database.host !== '172.17.0.13'
  || database.port !== 3306 || database.database !== envId || database.transport !== 'company-vpc'
  || typeof database.password !== 'string' || !database.password) throw Error('PAYMENT_DATABASE_TARGET_MISMATCH');
const source = path.join(root, 'cloudfunctions/payment-api');
const functionRoot = '.artifacts/company-payment-functions';
const staging = path.join(root, functionRoot, 'payment-api');
fs.mkdirSync(staging, { recursive: true });
const files = fs.readdirSync(source).filter(name => name.endsWith('.js') && !name.endsWith('.test.js') && !name.startsWith('test-')
  || ['package.json', 'package-lock.json'].includes(name));
for (const file of files) fs.copyFileSync(path.join(source, file), path.join(staging, file));
fs.cpSync(path.join(source, 'node_modules'), path.join(staging, 'node_modules'), { recursive: true });
const config = { appid: 'wxc94e1c1b38944511', paymentMode: 'DIRECT', prepayEnabled: false, closeEnabled: false,
  settlementEnabled: false, settlementExecutionEnabled: false, settlementPreparationEnabled: false,
  reconciliationEnabled: false, queryRelay: false, mutationRelay: false };
const deployment = { envId, functionRoot, functions: [{ name: 'payment-api', runtime: 'Nodejs20.19',
  handler: 'index.main', timeout: 60, memorySize: 256,
  vpc: { vpcId: 'vpc-fw6hzw6m', subnetId: 'subnet-ofbei8gl' },
  publicNetConfig: { PublicNetStatus: 'DISABLE', EipConfig: { EipStatus: 'DISABLE' } },
  envVariables: { PAYMENT_MYSQL_CONFIG_B64: Buffer.from(JSON.stringify(database)).toString('base64'),
    PAYMENT_WECHAT_CONFIG_B64: Buffer.from(JSON.stringify(config)).toString('base64') } }] };
// Separate filename prevents a later preparation from silently overwriting a live enabled configuration.
fs.writeFileSync(path.join(privateDir, 'company-payment-closed-deploy.json'), JSON.stringify(deployment, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ prepared: true, function: 'payment-api', fileCount: files.length,
  merchantCredentialsIncluded: false, prepayEnabled: false, settlementEnabled: false, deployed: false }));
