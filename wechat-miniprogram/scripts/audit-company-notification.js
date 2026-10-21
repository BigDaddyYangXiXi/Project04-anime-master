// Cloud configuration and read-only negative-path audit. Never invokes dispatch with sending enabled.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { envelope } = require('../cloudfunctions/order-api/notification-rpc');
const root = path.resolve(__dirname, '..');
const envId = 'cloudbase-d2g65rqbvee0bd978';
function cli(args) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), ...args, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result;
  try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch {}
  if (run.status !== 0 || !result?.data || result.error) throw Error('NOTIFICATION_AUDIT_CALL_FAILED');
  return result.data;
}
function invoke(name, event) { return JSON.parse(cli(['fn', 'invoke', name, '-d', JSON.stringify(event)]).RetMsg); }
try {
  const checks = {};
  for (const side of ['private', 'public']) {
    const expected = JSON.parse(fs.readFileSync(path.join(root, `.cloudbase-cli-config/company-notification-${side}-deploy.json`), 'utf8'));
    if (expected.envId !== envId) throw Error('TARGET_MISMATCH');
    const fn = expected.functions[0];
    const actual = cli(['api', 'scf', 'GetFunction', '--api-version', '2018-04-16', '--body',
      JSON.stringify({ FunctionName: fn.name, Namespace: envId, ShowCode: 'FALSE' })]);
    const vars = Object.fromEntries((actual.Environment?.Variables || []).map(v => [v.Key, v.Value]));
    checks[side + 'Active'] = actual.Status === 'Active';
    checks[side + 'Handler'] = actual.Handler === fn.handler;
    checks[side + 'NoTriggers'] = Array.isArray(actual.Triggers) && actual.Triggers.length === 0;
    checks[side + 'Configuration'] = Object.entries(fn.envVariables).every(([key, value]) => vars[key] === value);
    if (side === 'public') {
      checks.sendingClosed = vars.NOTIFICATION_SEND_ENABLED === 'false';
      checks.noPublicDatabaseCredential = !Object.hasOwn(vars, 'NOTIFICATION_MYSQL_CONFIG_B64');
    }
  }
  if (!Object.values(checks).every(Boolean)) throw Error('NOTIFICATION_CONFIGURATION_MISMATCH');
  const secret = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-notification-secrets.json'), 'utf8'));
  const candidate = { orderId: 'ord_' + '0'.repeat(32), key: '0'.repeat(64), recipientAccountId: 'acct_' + '0'.repeat(32),
    recipientOpenId: 'audit_no_write', recipientRole: 'BUYER', stage: 'CONTACTING', orderVersion: 1, occurredAt: 1 };
  const signed = envelope('recheck', candidate, secret.key);
  const read = invoke('order-notification-private', signed);
  checks.privateReadRejectedAbsentCandidate = read.ok === true && read.data === false;
  const tampered = invoke('order-notification-private', { ...signed, body: signed.body + ' ' });
  checks.tamperedRejected = tampered.ok === false && tampered.code === 'NOTIFICATION_PRIVATE_UNAVAILABLE';
  const closed = invoke('order-notification-public', {});
  checks.publicClosed = closed.ok === false && closed.code === 'NOTIFICATION_UNAVAILABLE';
  const cross = invoke('order-notification-public', envelope('recheck', candidate, secret.key));
  checks.publicToPrivateRead = cross.ok === true && cross.data === false;
  const blockedSend = invoke('order-notification-public', envelope('dispatch', {
    orderId: candidate.orderId, eventId: 'evt_' + '0'.repeat(32), recipientAccountId: candidate.recipientAccountId
  }, secret.key));
  checks.signedDispatchClosed = blockedSend.ok === false && blockedSend.code === 'NOTIFICATION_UNAVAILABLE';
  const recovery = invoke('order-notification-private', envelope('listRecovery', {
    afterId: '', since: 1, until: Date.now(), limit: 10
  }, secret.key));
  const page = recovery.data;
  checks.recoveryRead = recovery.ok === true && Number.isInteger(page?.scanned) && page.scanned >= 0 && page.scanned <= 10
    && Number.isInteger(page.skippedInvalid) && page.skippedInvalid >= 0 && page.skippedInvalid <= page.scanned
    && typeof page.hasMore === 'boolean' && typeof page.nextAfterId === 'string'
    && Array.isArray(page.candidates) && page.candidates.length <= page.scanned
    && page.candidates.every(item => Object.keys(item).sort().join(',') === 'eventId,orderId,recipientAccountId'
      && /^ord_[a-f0-9]{32}$/.test(item.orderId) && /^evt_[a-f0-9]{32}$/.test(item.eventId)
      && /^acct_[a-f0-9]{32}$/.test(item.recipientAccountId));
  const report = { ok: Object.values(checks).every(Boolean), checkedAt: new Date().toISOString(), checks,
    recovery: checks.recoveryRead ? { scanned: page.scanned, candidates: page.candidates.length,
      skippedInvalid: page.skippedInvalid, hasMore: page.hasMore } : null,
    writesRequested: false, sendsRequested: false, scope: 'Configuration, direct and cross-function private reads, closed send gate; not real notification acceptance.' };
  fs.writeFileSync(path.join(root, '.artifacts/company-notification-deployment-audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
} catch (_) { console.error('COMPANY_NOTIFICATION_AUDIT_FAILED'); process.exitCode = 1; }
