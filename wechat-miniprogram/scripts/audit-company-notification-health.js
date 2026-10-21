// Operator-only aggregates; never sends, grants consent, or clears consumed receipts.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function read(sql) {
  if (!/^SELECT\s/.test(sql)) throw Error('READ_ONLY_QUERY_REQUIRED');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
    'db', 'execute', '--read-only', '--sql', sql, '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let response;
  try { response = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1)); } catch (_) {}
  if (result.status !== 0 || response?.error || !Array.isArray(response?.data?.items)) throw Error('NOTIFICATION_HEALTH_READ_FAILED');
  return response.data.items;
}
try {
  if (read('SELECT DATABASE() AS db')[0]?.db !== 'cloudbase-d2g65rqbvee0bd978') throw Error('DATABASE_MISMATCH');
  const receipts = read(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status='STARTED'),0) AS started,
    COALESCE(SUM(status='UNKNOWN'),0) AS unknown,
    COALESCE(SUM(status='ACKNOWLEDGED'),0) AS acknowledged,
    COALESCE(SUM(status='REJECTED'),0) AS rejected,
    MIN(CASE WHEN status IN ('STARTED','UNKNOWN') THEN started_at END) AS oldestUnresolvedStartedAt,
    MAX(updated_at) AS latestReceiptUpdatedAt FROM order_notification_receipts`)[0];
  const observations = read(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status='ACCEPT'),0) AS acceptEvents,
    COALESCE(SUM(status='REJECT'),0) AS rejectEvents,
    COALESCE(SUM(event_type='CHANGE'),0) AS changeEvents,
    MAX(occurred_at) AS latestObservationAt FROM wechat_subscription_events`)[0];
  if (!receipts || !observations) throw Error('MISSING_AGGREGATES');
  const report = { checkedAt: new Date().toISOString(), databaseMatched: true, receipts, observations,
    writesRequested: false, sendsRequested: false,
    scope: 'Separate aggregate snapshots only. Observations are historical events, not current consent or credits. ACKNOWLEDGED is channel acceptance, not delivery. No automatic retry or alert scheduling.' };
  fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.artifacts/company-notification-health.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (_) { console.error('COMPANY_NOTIFICATION_HEALTH_AUDIT_FAILED'); process.exitCode = 1; }
