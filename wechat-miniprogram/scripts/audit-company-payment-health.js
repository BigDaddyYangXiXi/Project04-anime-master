// Operator-only aggregate inspection. No identifiers, payloads, secrets or state mutations.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
function read(sql) {
  if (!/^SELECT\s/.test(sql)) throw Error('READ_ONLY_QUERY_REQUIRED');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
    'db', 'execute', '--read-only', '--sql', sql, '--json'], { cwd: root, encoding: 'utf8' });
  let response;
  try { response = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch {}
  if (run.status !== 0 || response?.error || !Array.isArray(response?.data?.items)) throw Error('PAYMENT_HEALTH_READ_FAILED');
  return response.data.items;
}
try {
  if (read('SELECT DATABASE() AS db')[0]?.db !== 'cloudbase-d2g65rqbvee0bd978') throw Error('DATABASE_MISMATCH');
  const paymentCounts = read(`SELECT
    COUNT(*) AS total,
    COALESCE(SUM(status='PAID_REQUIRES_REVIEW'),0) AS receiptsRequiringReview,
    COALESCE(SUM(status='CREATED' AND prepay_started_at>0 AND prepay_id IS NULL),0) AS unresolvedPrepayAttempts,
    COALESCE(SUM(status='CREATED' AND prepay_recovery_started_at>0),0) AS unfinishedRecovery
    FROM order_payments`)[0];
  const settlementCounts = read(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status='PREPARED'),0) AS prepared,
    COALESCE(SUM(status='PROCESSING'),0) AS processing,
    COALESCE(SUM(status='FEE_SUCCEEDED'),0) AS feeSucceeded,
    COALESCE(SUM(status='CLOSED'),0) AS closed FROM order_settlement_tasks`)[0];
  const [intents] = read(`SELECT COUNT(*) AS unpreparedAcceptedOrders FROM order_aggregates o
    LEFT JOIN order_settlement_tasks s ON s.order_id=o.id
    WHERE o.stage='COMPLETED' AND JSON_UNQUOTE(JSON_EXTRACT(o.payload,'$.settlementIntent.status'))='PENDING' AND s.id IS NULL`);
  const [holds] = read(`SELECT COALESCE(SUM(hold_reason IS NOT NULL),0) AS heldOrders,
    COALESCE(SUM(hold_reason IS NOT NULL AND settlement_task_id IS NOT NULL),0) AS holdsAfterSettlementStarted
    FROM order_funds_interlocks`);
  const [replays] = read('SELECT COUNT(*) AS consumedRequestSignatures FROM payment_mutation_receipts');
  const report = { checkedAt: new Date().toISOString(), databaseMatched: true, paymentCounts,
    settlementCounts, ...intents, ...holds, ...replays,
    scope: 'Aggregate database state only. Counts may overlap and change between queries. Not channel reconciliation, an alert scheduler, or payment acceptance.' };
  fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.artifacts/company-payment-health.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch {
  console.error('COMPANY_PAYMENT_HEALTH_AUDIT_FAILED'); process.exitCode = 1;
}
