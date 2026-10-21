// Local preparation only. Does not create accounts, grant access, deploy or send.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, execSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = 'cloudbase-d2g65rqbvee0bd978';
const configDir = path.join(root, '.cloudbase-cli-config');
const source = path.join(root, 'cloudfunctions/order-api');
const functionRoot = '.artifacts/company-notification-functions';
const secretFile = path.join(configDir, 'company-notification-secrets.json');
const targets = ['company-notification-private-deploy.json', 'company-notification-public-deploy.json'];
for (const file of [secretFile, ...targets.map(name => path.join(configDir, name))]) {
  execFileSync('git', ['check-ignore', '--quiet', file], { cwd: root });
}
if (require('../project.config.json').appid !== 'wxc94e1c1b38944511' || require('../cloudbaserc.json').envId !== env) throw Error('TARGET_MISMATCH');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, JSON.stringify({ env, key: crypto.randomBytes(32).toString('hex'),
  database: { transport: 'company-vpc', host: '172.17.0.13', port: 3306, database: env, user: 'am_notification',
    password: 'Aa1!' + crypto.randomBytes(24).toString('hex') } }), { flag: 'wx', mode: 0o600 });
const secrets = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
if (secrets.env !== env || !/^[a-f0-9]{64}$/.test(secrets.key) || secrets.database.user !== 'am_notification'
  || secrets.database.database !== env || secrets.database.host !== '172.17.0.13') throw Error('NOTIFICATION_CONFIG_MISMATCH');
const definitions = [
  { name: 'order-notification-private', handler: 'notification-private.main', timeout: 20,
    vpc: { vpcId: 'vpc-fw6hzw6m', subnetId: 'subnet-ofbei8gl' },
    publicNetConfig: { PublicNetStatus: 'DISABLE', EipConfig: { EipStatus: 'DISABLE' } },
    envVariables: { NOTIFICATION_RELAY_KEY: secrets.key, NOTIFICATION_MYSQL_CONFIG_B64: Buffer.from(JSON.stringify(secrets.database)).toString('base64') },
    files: ['notification-private.js', 'notification-rpc.js', 'notification-candidate.js', 'notification-message.js', 'notification-claim.js', 'notification-recheck.js', 'notification-receipt.js', 'notification-recovery.js'] },
  { name: 'order-notification-public', handler: 'notification-public.main', timeout: 60,
    vpc: { vpcId: '', subnetId: '' },
    publicNetConfig: { PublicNetStatus: 'ENABLE', EipConfig: { EipStatus: 'DISABLE' } },
    envVariables: { NOTIFICATION_RELAY_KEY: secrets.key, NOTIFICATION_SEND_ENABLED: 'false', NOTIFICATION_MINIPROGRAM_STATE: 'trial' },
    files: ['notification-public.js', 'notification-rpc.js', 'notification-dispatch.js', 'notification-message.js'] }
];
for (const [index, { files, ...definition }] of definitions.entries()) {
  const folder = path.join(root, functionRoot, definition.name);
  fs.mkdirSync(folder, { recursive: true });
  for (const name of files) fs.copyFileSync(path.join(source, name), path.join(folder, name));
  const packageSource = index === 0 ? path.join(__dirname, 'deployment-packages/order-notification-private') : source;
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(packageSource, name), path.join(folder, name));
  if (index === 0) {
    // npm ci removes stale SDK dependencies left by earlier preparation runs.
    execSync('npm ci --offline --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: folder, stdio: 'pipe' });
  } else {
    fs.cpSync(path.join(source, 'node_modules'), path.join(folder, 'node_modules'), { recursive: true });
  }
  fs.writeFileSync(path.join(folder, 'config.json'), JSON.stringify({ permissions: { openapi: index === 1 ? ['subscribeMessage.send'] : [] } }, null, 2));
  fs.writeFileSync(path.join(configDir, targets[index]), JSON.stringify({ envId: env, functionRoot,
    functions: [{ ...definition, runtime: 'Nodejs20.19', triggers: [] }] }, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ prepared: true, deployed: false, sendingEnabled: false, accountCreated: false,
  privateSource: '172.17.0.0/255.255.240.0', account: 'am_notification',
  grants: { accounts: 'SELECT', wechat_identities: 'SELECT', order_aggregates: 'SELECT',
    wechat_subscription_events: 'SELECT', order_notification_receipts: 'SELECT, INSERT, UPDATE' } }));
