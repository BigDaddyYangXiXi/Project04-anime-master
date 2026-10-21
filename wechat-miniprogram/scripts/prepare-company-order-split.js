// Local packaging only; does not deploy, change networks or invoke business actions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const privateDir = path.join(root, '.cloudbase-cli-config');
const original = JSON.parse(fs.readFileSync(path.join(privateDir, 'company-order-deploy.json')));
const current = original.functions.find(f => f.name === 'order-api');
if (original.envId !== 'cloudbase-d2g65rqbvee0bd978' || !current?.envVariables?.ORDER_CONTACT_ENCRYPTION_KEY
  || !current.envVariables.ORDER_MYSQL_CONFIG_B64 || current.vpc?.vpcId !== 'vpc-fw6hzw6m') throw Error('Unexpected original deployment');
const secretPath = path.join(privateDir, 'company-order-split-secret.json');
if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, JSON.stringify({ key: crypto.randomBytes(32).toString('base64') }), { flag: 'wx' });
const secret = JSON.parse(fs.readFileSync(secretPath)).key;
if (Buffer.from(secret, 'base64').length !== 32) throw Error('Invalid existing relay key');
const source = path.join(root, 'cloudfunctions/order-api');
const staging = path.join(root, '.artifacts/order-slot-functions/order-slot-confirm');
fs.mkdirSync(staging, { recursive: true });
for (const file of ['slot-relay.js', 'slot-runtime.js', 'slot-store.js']) {
  fs.copyFileSync(path.join(source, file), path.join(staging, file));
}
for (const file of ['package.json', 'package-lock.json']) {
  fs.copyFileSync(path.join(__dirname, 'deployment-packages/order-slot-confirm', file), path.join(staging, file));
}
// The private handler uses mysql2 only; the outbound SDK helper stays in order-api.
require('node:child_process').execSync('npm ci --offline --omit=dev --ignore-scripts --no-audit --no-fund', { cwd: staging, stdio: 'pipe' });
const slot = { ...current, name: 'order-slot-confirm', handler: 'slot-relay.main', timeout: 20,
  envVariables: { ORDER_MYSQL_CONFIG_B64: current.envVariables.ORDER_MYSQL_CONFIG_B64, ORDER_SLOT_RELAY_KEY: secret } };
const api = { ...current, vpc: { vpcId: '', subnetId: '' },
  publicNetConfig: { PublicNetStatus: 'ENABLE', EipConfig: { EipStatus: 'DISABLE' } },
  envVariables: { ORDER_CONTACT_ENCRYPTION_KEY: current.envVariables.ORDER_CONTACT_ENCRYPTION_KEY,
    ORDER_SLOT_RELAY_KEY: secret, ORDER_SLOT_RELAY_ENABLED: 'true', ORDER_NOTIFICATION_ENABLED: 'false' } };
function save(name, functionRoot, fn) {
  fs.writeFileSync(path.join(privateDir, name), JSON.stringify({ envId: original.envId, functionRoot, functions: [fn] }, null, 2));
}
save('company-order-slot-deploy.json', '.artifacts/order-slot-functions', slot);
save('company-order-public-deploy.json', 'cloudfunctions', api);
const network = { ...api }; delete network.envVariables;
save('company-order-public-network.json', 'cloudfunctions', network);
console.log(JSON.stringify({ prepared: true, functions: ['order-slot-confirm', 'order-api'], deployed: false,
  contactEncryptionKeyPreserved: true, databaseCredentialsOnlyInPrivateFunction: true }));
