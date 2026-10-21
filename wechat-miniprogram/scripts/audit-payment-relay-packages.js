// Inspect the actual staged packages; never makes network or database calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const names = ['payment-mutation-guard', 'payment-query-relay', 'payment-mutation-relay'];
const reports = [];
for (const name of names) {
  const deployment = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config', `${name}-closed-deploy.json`)));
  const [fn] = deployment.functions;
  assert.equal(deployment.envId, 'cloudbase-d2g65rqbvee0bd978');
  assert.equal(deployment.functions.length, 1);
  assert.equal(fn.name, name);
  assert.deepEqual(fn.triggers, []);
  const privateNetwork = name === 'payment-mutation-guard';
  const configKey = `PAYMENT_${name.slice('payment-'.length).replaceAll('-', '_').toUpperCase()}_CONFIG_B64`;
  assert.deepEqual(Object.keys(fn.envVariables).sort(), [configKey, ...(privateNetwork ? ['PAYMENT_MYSQL_CONFIG_B64'] : [])].sort());
  const config = JSON.parse(Buffer.from(fn.envVariables[configKey], 'base64').toString());
  assert.deepEqual(config, name === 'payment-query-relay' ? { enabled: false } : { enabled: false, mutationsEnabled: false });
  assert.deepEqual(fn.vpc, privateNetwork ? { vpcId: 'vpc-fw6hzw6m', subnetId: 'subnet-ofbei8gl' } : { vpcId: '', subnetId: '' });
  assert.equal(fn.publicNetConfig.PublicNetStatus, privateNetwork ? 'DISABLE' : 'ENABLE');
  assert.equal(fn.publicNetConfig.EipConfig.EipStatus, 'DISABLE');
  const folder = path.join(root, deployment.functionRoot, name);
  const files = fs.readdirSync(folder).filter(file => file.endsWith('.js'));
  for (const file of files) assert.ok(fs.readFileSync(path.join(folder, file)).equals(fs.readFileSync(path.join(root, 'cloudfunctions/payment-api', file))));
  assert.equal(files.includes('index.js'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'config.json'))), { permissions: { openapi: [] } });
  // Load the configured handler in isolation and fail if closed handling even attempts I/O.
  const script = `
    const Module = require('node:module');
    const original = Module._load;
    let ioAttempts = 0;
    Module._load = function(name, ...args) {
      if (['mysql2/promise', '@cloudbase/node-sdk'].includes(name)) { ioAttempts++; throw Error('CLOSED_ENTRY_ATTEMPTED_IO'); }
      return original.call(this, name, ...args);
    };
    require('node:https').request = () => { ioAttempts++; throw Error('CLOSED_ENTRY_ATTEMPTED_HTTP'); };
    const main = require('./${fn.handler.split('.')[0]}').main;
    main({ path: '/v3/combine-transactions/jsapi', body: '{}', authorization: 'invalid' })
      .then(result => { if (result.ok !== false || ioAttempts !== 0) process.exitCode = 1; else process.stdout.write('closed'); });
  `;
  const child = spawnSync(process.execPath, ['-e', script], { cwd: folder, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, SCF_NAMESPACE: deployment.envId, ...fn.envVariables } });
  assert.equal(child.status, 0, `${name}: closed handler failed`);
  assert.equal(child.stdout, 'closed');
  reports.push({ name, privateNetwork, sourceFiles: files.length, closedEntry: true, publicDatabaseCredentials: false });
}
const report = { checkedAt: new Date().toISOString(), ok: true, deployed: false, reports };
fs.writeFileSync(path.join(root, '.artifacts/payment-relay-package-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
