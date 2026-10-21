// Invalid actions only: no business mutations or actual private information.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sentinel = 'audit-private-sentinel-do-not-echo';
const checks = [];
for (const name of ['catalog-read', 'account-bootstrap', 'account-api', 'media-upload', 'media-security-submit',
  'availability-api', 'order-api', 'project-api', 'saved-items-api', 'provider-catalog-draft']) {
  const event = { action: name === 'account-bootstrap' ? 'getSession' : sentinel,
    phone: sentinel, fileUrl: `https://example.test/${sentinel}`, token: sentinel };
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), 'fn', 'invoke', name,
    '-d', JSON.stringify(event), '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let response, result;
  try {
    response = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1));
    result = JSON.parse(response.data.RetMsg);
  } catch (_) {}
  const logs = response?.data?.Log;
  // Administrative CLI invocations do not provide a mini-program caller here.
  // Private services must stop at identity validation; catalog is publicly readable.
  const expectedCode = name === 'catalog-read' ? 'INVALID_ACTION' : 'AUTH_CONTEXT_MISSING';
  const rejected = run.status === 0 && result?.ok === false && result?.error?.code === expectedCode;
  const redacted = typeof logs === 'string' && !logs.includes(sentinel) && !JSON.stringify(result).includes(sentinel);
  checks.push({ name, ok: rejected && redacted, expectedCode, code: result?.error?.code || 'INVOKE_FAILED',
    logsAvailable: typeof logs === 'string', redacted, requestId: response?.data?.RequestId || null });
}
const report = { checkedAt: new Date().toISOString(), ok: checks.every(check => check.ok), writesPerformed: false, checks };
fs.writeFileSync(path.join(root, '.artifacts/company-public-errors-runtime.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;
