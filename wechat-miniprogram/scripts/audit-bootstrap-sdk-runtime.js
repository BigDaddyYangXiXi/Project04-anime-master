const fs = require('node:fs'), { spawnSync } = require('node:child_process');
const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw Error('INVALID_PHASE');
const name = process.argv[3] || 'account-bootstrap';
if (!['account-api', 'account-bootstrap', 'catalog-read', 'availability-api', 'order-api'].includes(name)) throw Error('INVALID_TARGET');
const config = require(`../.cloudbase-cli-config/${name === 'account-api' ? 'account' : name}-sdk-deploy.json`);
function cli(action, body) {
  const r = spawnSync(process.execPath, ['scripts/cloudbase-company-cli.js', 'api', 'scf', action, '--api-version', '2018-04-16', '--body', JSON.stringify(body), '--json'], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw Error('AUDIT_QUERY_FAILED');
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)).data;
}
const target = { FunctionName: name, Namespace: config.envId };
const reports = [];
const requests = name === 'catalog-read'
  ? [{ action: 'listDiscovery', cityCode: '310000', date: '2026-09-28' }, { action: 'listProviders' }]
  : name === 'order-api' ? [{ action: 'listOrders' }, { action: 'listOrders' }] : name === 'availability-api' ? [{ action: 'getMine' }, { action: 'getMine' }] : [{ action: 'getSession' }, { action: 'getSession' }];
for (const request of requests) {
  const result = cli('Invoke', { ...target, ClientContext: JSON.stringify(request), LogType: 'None' }).Result;
  const reply = JSON.parse(result.RetMsg);
  if (name === 'catalog-read') {
    if (reply.ok !== true || !Array.isArray(reply.data?.providers)) throw Error('PUBLIC_READ_FAILED');
    const timing = reply.serverTiming;
    const serverTiming = timing && ['sdkLoadMs', 'initMs', 'readMs'].every(key => Number.isSafeInteger(timing[key]) && timing[key] >= 0)
      ? { sdkLoadMs: timing.sdkLoadMs, initMs: timing.initMs, readMs: timing.readMs } : undefined;
    reports.push({ action: request.action, durationMs: result.Duration, serverTiming, providers: reply.data.providers.length,
      payloadSha256: require('node:crypto').createHash('sha256').update(JSON.stringify(reply.data)).digest('hex') });
  } else {
    if (reply.error?.code !== 'AUTH_CONTEXT_MISSING' || reply.ok !== false) throw Error('IDENTITY_GATE_FAILED');
    reports.push({ durationMs: result.Duration, code: reply.error.code });
  }
}
const live = cli('GetFunction', { ...target, ShowCode: 'FALSE' }), fn = config.functions[0];
const vars = Object.fromEntries((live.Environment?.Variables || []).map(v => [v.Key, v.Value]));
const same = live.Status === 'Active' && live.Runtime === fn.runtime && live.MemorySize === fn.memorySize && live.Timeout === fn.timeout
  && Object.keys(vars).length === Object.keys(fn.envVariables).length && Object.entries(fn.envVariables).every(([k, v]) => vars[k] === v)
  && (live.VpcConfig?.VpcId || '') === (fn.vpc?.vpcId || '') && (live.VpcConfig?.SubnetId || '') === (fn.vpc?.subnetId || '')
  && live.PublicNetConfig?.PublicNetStatus === fn.publicNetConfig.PublicNetStatus
  && live.PublicNetConfig?.EipConfig?.EipStatus === fn.publicNetConfig.EipConfig.EipStatus;
if (!same) throw Error('LIVE_CONFIGURATION_MISMATCH');
const report = { checkedAt: new Date().toISOString(), phase, reports, configurationPreserved: true,
  scope: name === 'catalog-read' ? 'Public cloud catalog read only; not phone performance acceptance.' : 'Untrusted identity rejection only; not authenticated business or phone performance acceptance.' };
fs.writeFileSync(`.artifacts/${name}-sdk-${phase}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
