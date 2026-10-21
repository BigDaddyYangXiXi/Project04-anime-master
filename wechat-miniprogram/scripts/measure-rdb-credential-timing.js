// Temporary, token-gated, fixed read-only measurement. Always restore the entry.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const configPath = '.cloudbase-cli-config/storage-timing-deploy.json';
const config = JSON.parse(fs.readFileSync(path.join(root, configPath), 'utf8'));
const name = 'network-probe-public';
const folder = path.join(root, config.functionRoot, name), entry = path.join(folder, 'index.js');
const original = fs.readFileSync(entry, 'utf8');
const marker = "  if (process.env.NETWORK_PROBE_MODE === 'public') {";
if (!original.includes(marker) || original.includes('credentialTiming')) throw Error('PROBE_ENTRY_NOT_RESTORED');
function cli(args, timeout = 60000) {
  const run = spawnSync(process.execPath, ['scripts/cloudbase-company-cli.js', ...args], { cwd: root, encoding: 'utf8', timeout });
  if (run.status !== 0) throw Error('PROBE_CLI_FAILED');
  return run.stdout;
}
function query(action, body) {
  const output = cli(['api', 'scf', action, '--api-version', '2018-04-16', '--body', JSON.stringify(body), '--json']);
  return JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)).data;
}
function deploy() { cli(['fn', 'deploy', name, '--config-file', configPath, '--install-dependency', 'false', '--force'], 180000); }
const target = { FunctionName: name, Namespace: config.envId };
const current = query('GetFunction', { ...target, ShowCode: 'FALSE' });
const token = (current.Environment?.Variables || []).find(v => v.Key === 'NETWORK_PROBE_TOKEN')?.Value;
if (current.Status !== 'Active' || !/^[a-f0-9]{64}$/.test(token || '')) throw Error('PROBE_GATE_INVALID');
const report = { checkedAt: new Date().toISOString(), samples: [], restored: false };
fs.copyFileSync(entry, path.join(root, '.artifacts/credential-timing-original-index.js'));
try {
  fs.copyFileSync(path.join(__dirname, 'probes/rdb-connection-timing.js'), path.join(folder, 'rdb-connection-timing.js'));
  fs.writeFileSync(entry, original.replace(marker, `  if (event.action === 'credentialTiming') {
    const started = Date.now();
    const sdk = require('./vendor/dist/utils/cloudbase.cjs');
    const sdkLoadMs = Date.now() - started;
    return { ...await require('./rdb-connection-timing').rdbConnectionTiming(event, sdk), sdkLoadMs };
  }
${marker}`));
  deploy(); console.log('Diagnostic deployment completed.');
  for (let i = 0; i < 3; i++) {
    const invoked = query('Invoke', { ...target, ClientContext: JSON.stringify({ action: 'credentialTiming', keepalive: false, token }), LogType: 'None' });
    const value = JSON.parse(invoked.Result.RetMsg);
    if (!value.ok || value.credentialTimes?.length !== 3) throw Error('PROBE_MEASUREMENT_INVALID');
    const sample = { durationMs: invoked.Result.Duration, sdkLoadMs: value.sdkLoadMs, initMs: value.initMs, times: value.times, credentialTimes: value.credentialTimes };
    report.samples.push(sample); console.log(JSON.stringify(sample));
  }
} finally {
  fs.writeFileSync(entry, original);
  try { deploy(); report.restored = true; console.log('Original diagnostic entry restored.'); }
  finally { fs.writeFileSync(path.join(root, '.artifacts/rdb-credential-timing-20260929.json'), JSON.stringify(report, null, 2)); }
}
