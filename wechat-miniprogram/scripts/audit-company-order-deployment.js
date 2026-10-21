const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const original = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-order-deploy.json')));
const expectedContactKey = original.functions[0].envVariables.ORDER_CONTACT_ENCRYPTION_KEY;
const expectedRelayKey = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-order-split-secret.json'))).key;
const results = [];
for (const name of ['order-api', 'order-slot-confirm']) {
  const raw = execFileSync(process.execPath, [path.join(root, 'scripts/cloudbase-company-cli.js'), 'api', 'scf', 'GetFunction',
    '--api-version', '2018-04-16', '--body', JSON.stringify({ FunctionName: name, Namespace: original.envId, ShowCode: 'FALSE' }), '--json'],
  { cwd: root, encoding: 'utf8', timeout: 30000 });
  const value = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).data;
  const env = Object.fromEntries((value.Environment?.Variables || []).map(item => [item.Key, item.Value]));
  const isPrivate = name === 'order-slot-confirm';
  results.push({ name, status: value.Status, handler: value.Handler,
    vpcMatched: isPrivate ? value.VpcConfig?.VpcId === 'vpc-fw6hzw6m' && value.VpcConfig?.SubnetId === 'subnet-ofbei8gl' : !value.VpcConfig?.VpcId,
    networkMatched: value.PublicNetConfig?.PublicNetStatus === (isPrivate ? 'DISABLE' : 'ENABLE'),
    fixedIpDisabled: value.PublicNetConfig?.EipConfig?.EipStatus === 'DISABLE',
    relayKeyMatched: env.ORDER_SLOT_RELAY_KEY === expectedRelayKey,
    databaseConfigurationMatched: isPrivate ? env.ORDER_MYSQL_CONFIG_B64 === original.functions[0].envVariables.ORDER_MYSQL_CONFIG_B64
      : !env.ORDER_MYSQL_CONFIG_B64 && !env.ORDER_MYSQL_CONFIG,
    contactKeyMatched: isPrivate ? !env.ORDER_CONTACT_ENCRYPTION_KEY : env.ORDER_CONTACT_ENCRYPTION_KEY === expectedContactKey,
    relayEnabled: isPrivate || env.ORDER_SLOT_RELAY_ENABLED === 'true',
    notificationTriggerClosed: isPrivate || env.ORDER_NOTIFICATION_ENABLED === 'false' });
}
const ok = results.every(r => r.status === 'Active' && r.vpcMatched && r.networkMatched && r.fixedIpDisabled
  && r.relayKeyMatched && r.databaseConfigurationMatched && r.contactKeyMatched && r.relayEnabled && r.notificationTriggerClosed);
console.log(JSON.stringify({ ok, results }, null, 2));
if (!ok) process.exitCode = 1;
