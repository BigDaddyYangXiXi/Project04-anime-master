// Local preparation only. Does not grant access, deploy, expose HTTP routes or enable money actions.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const envId = 'cloudbase-d2g65rqbvee0bd978';
const source = path.join(root, 'cloudfunctions/payment-api');
const functionRoot = '.artifacts/company-payment-relays';
const configDir = path.join(root, '.cloudbase-cli-config');
if (require('../project.config.json').appid !== 'wxc94e1c1b38944511'
  || require('../cloudbaserc.json').envId !== envId) throw Error('PAYMENT_TARGET_MISMATCH');
const database = JSON.parse(fs.readFileSync(path.join(configDir, 'company-database-accounts.json'))).am_payment;
if (database?.transport !== 'company-vpc' || database.host !== '172.17.0.13' || database.port !== 3306
  || database.database !== envId || database.user !== 'am_payment' || !database.password) throw Error('PAYMENT_DATABASE_MISMATCH');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64');
// These imports are the existing query transport's dependency closure; no service entry or merchant key is copied.
const transport = ['wechat-query.js', 'payment-notifications.js', 'wechat-verification.js', 'direct-receipt.js',
  'payment-store.js', 'fee-policy.js', 'fund-ledger.js', 'query-relay-client.js', 'payment-timeouts.js'];
const definitions = [
  { name: 'payment-mutation-guard', handler: 'mutation-replay-guard.main', private: true,
    files: ['mutation-replay-guard.js', 'relay-auth.js'],
    envVariables: { PAYMENT_MUTATION_GUARD_CONFIG_B64: encode({ enabled: false, mutationsEnabled: false }),
      PAYMENT_MYSQL_CONFIG_B64: encode(database) } },
  { name: 'payment-query-relay', handler: 'query-relay.main', private: false,
    files: ['query-relay.js', 'relay-auth.js', ...transport],
    envVariables: { PAYMENT_QUERY_RELAY_CONFIG_B64: encode({ enabled: false }) } },
  { name: 'payment-mutation-relay', handler: 'mutation-relay.main', private: false,
    files: ['mutation-relay.js', 'mutation-replay-guard.js', 'relay-auth.js', ...transport],
    envVariables: { PAYMENT_MUTATION_RELAY_CONFIG_B64: encode({ enabled: false, mutationsEnabled: false }) } }
];
for (const definition of definitions) {
  const folder = path.join(root, functionRoot, definition.name);
  const configFile = path.join(configDir, `${definition.name}-closed-deploy.json`);
  for (const ignored of [folder, configFile]) execFileSync('git', ['check-ignore', '--quiet', ignored], { cwd: root });
  fs.mkdirSync(folder, { recursive: true });
  // Refuse stale executable files rather than silently deploying an old entry or unrelated handler.
  const allowed = new Set([...definition.files, 'package.json', 'package-lock.json', 'node_modules', 'config.json']);
  if (fs.readdirSync(folder).some(name => !allowed.has(name))) throw Error('PAYMENT_RELAY_STAGING_REVIEW_REQUIRED');
  for (const name of definition.files) fs.copyFileSync(path.join(source, name), path.join(folder, name));
  if (definition.name === 'payment-query-relay') {
    const manifest = { name: definition.name, version: '0.7.0', private: true };
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(folder, 'package-lock.json'), JSON.stringify({ name: manifest.name,
      version: manifest.version, lockfileVersion: 3, requires: true, packages: { '': manifest } }, null, 2));
    if (fs.existsSync(path.join(folder, 'node_modules'))) throw Error('QUERY_RELAY_UNEXPECTED_DEPENDENCIES');
  } else {
    // Reuse the audited, locked payment runtime without resolving new dependency versions.
    for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, name), path.join(folder, name));
    fs.cpSync(path.join(source, 'node_modules'), path.join(folder, 'node_modules'), { recursive: true });
  }
  fs.writeFileSync(path.join(folder, 'config.json'), JSON.stringify({ permissions: { openapi: [] } }, null, 2));
  const { files, private: privateNetwork, ...fn } = definition;
  fs.writeFileSync(configFile, JSON.stringify({ envId, functionRoot, functions: [{ ...fn, runtime: 'Nodejs20.19',
    timeout: privateNetwork ? 10 : 20, memorySize: 256, triggers: [],
    vpc: privateNetwork ? { vpcId: 'vpc-fw6hzw6m', subnetId: 'subnet-ofbei8gl' } : { vpcId: '', subnetId: '' },
    publicNetConfig: { PublicNetStatus: privateNetwork ? 'DISABLE' : 'ENABLE', EipConfig: { EipStatus: 'DISABLE' } }
  }] }, null, 2), { mode: 0o600 });
  require('./company-deploy-preflight').preflight(['fn', 'deploy', fn.name, '--config-file', configFile,
    '--install-dependency', 'false'], root);
  console.log(JSON.stringify({ prepared: fn.name, privateNetwork, deployed: false, enabled: false }));
}
