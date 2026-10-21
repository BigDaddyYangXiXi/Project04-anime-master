// Read-only public catalog samples. Does not measure authenticated or device startup.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const samples = [];
for (let sample = 1; sample <= 2; sample++) {
  const started = Date.now();
  const body = {
    FunctionName: 'catalog-read', Namespace: 'cloudbase-d2g65rqbvee0bd978', LogType: 'None',
    ClientContext: JSON.stringify({ action: 'listDiscovery', cityCode: '310000', career: '妆娘',
      mode: 'works', serviceableOnly: true, nearest: true, limit: 50 })
  };
  const command = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
    'api', 'scf', 'Invoke', '--api-version', '2018-04-16', '--body', JSON.stringify(body), '--json'],
  { cwd: root, encoding: 'utf8', timeout: 45000 });
  if (command.status !== 0) throw new Error('PUBLIC_DISCOVERY_QUERY_FAILED');
  const output = command.stdout;
  const result = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)).data.Result;
  const reply = JSON.parse(result.RetMsg);
  if (!reply.ok || !Array.isArray(reply.data?.providers)) throw new Error('PUBLIC_DISCOVERY_READ_FAILED');
  const timing = reply.serverTiming;
  samples.push({ sample, cliRoundtripMs: Date.now() - started, functionDurationMs: result.Duration,
    serverTiming: timing && ['sdkLoadMs', 'initMs', 'readMs'].every(key => Number.isSafeInteger(timing[key]) && timing[key] >= 0)
      ? { sdkLoadMs: timing.sdkLoadMs, initMs: timing.initMs, readMs: timing.readMs } : null,
    providerCount: reply.data.providers.length, total: reply.data.total,
    nearbyUnavailable: reply.data.nearbyUnavailable === true });
}
const report = { checkedAt: new Date().toISOString(), samples,
  scope: 'Two public reads via SCF API; CLI roundtrip includes CLI initialization. No proof of cold instance, real user session, device startup, or nonempty publication.' };
fs.writeFileSync(path.join(root, '.artifacts/public-discovery-timing-latest.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, `.artifacts/public-discovery-timing-${report.checkedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
