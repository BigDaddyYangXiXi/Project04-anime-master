// Management invocations with read-only actions, no supplied identity or business mutations.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const actions = { 'auth-probe': null, 'account-bootstrap': 'getSession', 'account-api': 'getMine',
  'order-api': 'listOrders', 'payment-api': 'refreshPayment', 'project-api': 'listProjects',
  'saved-items-api': 'listMine', 'availability-api': 'getMine', 'provider-catalog-draft': 'getDraft',
  'media-upload': 'getOwnedMedia', 'media-security-submit': 'getImageStatus' };
const names = process.argv.slice(2);
try {
  if (!names.length || names.some(name => !Object.hasOwn(actions, name)) || new Set(names).size !== names.length) throw Error('EXPLICIT_SUPPORTED_FUNCTIONS_REQUIRED');
  const checks = [];
  for (const name of names) {
    const event = actions[name] ? { action: actions[name] } : {};
    const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), 'fn', 'invoke', name,
      '-d', JSON.stringify(event), '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
    if (run.status !== 0) throw Error('INVOCATION_FAILED');
    const response = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1));
    const result = JSON.parse(response.data.RetMsg);
    checks.push({ name, rejected: result.ok === false && result.error?.code === 'AUTH_CONTEXT_MISSING' });
  }
  const report = { ok: checks.every(check => check.rejected), checkedAt: new Date().toISOString(), checks,
    scope: 'Management requests without supplied WeChat identity, read-only actions only. Not cross-user or full business acceptance.' };
  fs.writeFileSync(path.join(root, '.artifacts/current-request-identity-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
} catch (_) { console.error('CURRENT_REQUEST_IDENTITY_AUDIT_FAILED'); process.exitCode = 1; }
