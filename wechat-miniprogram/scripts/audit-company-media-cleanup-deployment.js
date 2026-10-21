// Configuration output may contain credentials: only emit fixed checks and public error codes.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let phase = 'configuration';
const checks = {};
function cli(args) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), ...args],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (run.status !== 0) throw Error('CLEANUP_AUDIT_CALL_FAILED');
  const json = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1));
  if (json.error || !json.data) throw Error('CLEANUP_AUDIT_RESPONSE_INVALID');
  return json.data;
}
try {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-media-cleanup-deploy.json'), 'utf8'));
  if (config.envId !== 'cloudbase-d2g65rqbvee0bd978') throw Error('COMPANY_ENVIRONMENT_MISMATCH');
  const fn = config.functions[0];
  const actual = cli(['api', 'scf', 'GetFunction', '--api-version', '2018-04-16', '--body',
    JSON.stringify({ FunctionName: 'media-pending-cleanup', Namespace: config.envId, ShowCode: 'FALSE' }), '--json']);
  const env = Object.fromEntries((actual.Environment?.Variables || []).map(item => [item.Key, item.Value]));
  Object.assign(checks, { active: actual.Status === 'Active', handlerMatched: actual.Handler === 'index.main',
    noTriggers: Array.isArray(actual.Triggers) && actual.Triggers.length === 0,
    tokenMatched: /^[a-f0-9]{64}$/.test(env.MEDIA_CLEANUP_TOKEN || '')
      && env.MEDIA_CLEANUP_TOKEN === fn.envVariables.MEDIA_CLEANUP_TOKEN });
  if (!Object.values(checks).every(Boolean)) throw Error('CLEANUP_DEPLOYMENT_MISMATCH');
  const wrongToken = env.MEDIA_CLEANUP_TOKEN === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  for (const [name, event] of [
    ['noTokenRejected', {}], ['fakeTimerRejected', { Type: 'Timer', TriggerName: 'audit-fake-timer' }],
    ['wrongTokenRejected', { cleanupToken: wrongToken }]
  ]) {
    phase = name;
    const invocation = cli(['api', 'scf', 'Invoke', '--api-version', '2018-04-16', '--body',
      JSON.stringify({ FunctionName: 'media-pending-cleanup', Namespace: config.envId,
        ClientContext: JSON.stringify(event), LogType: 'Tail' }), '--json']);
    if (invocation.Result?.InvokeResult !== 0) throw Error('CLEANUP_INVOCATION_FAILED');
    const result = JSON.parse(invocation.Result.RetMsg);
    checks[name] = result.ok === false && result.error?.code === 'CALLER_NOT_ALLOWED';
  }
  const report = { checkedAt: new Date().toISOString(), ok: Object.values(checks).every(Boolean), checks,
    cleanupRequested: false, scope: 'Deployment and rejection checks only; no valid cleanup token submitted.' };
  fs.writeFileSync(path.join(root, '.artifacts/company-media-cleanup-deployment.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
} catch {
  const report = { checkedAt: new Date().toISOString(), ok: false, cleanupRequested: false,
    code: 'COMPANY_MEDIA_CLEANUP_AUDIT_FAILED', phase, checks };
  fs.writeFileSync(path.join(root, '.artifacts/company-media-cleanup-deployment.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report)); process.exitCode = 1;
}
