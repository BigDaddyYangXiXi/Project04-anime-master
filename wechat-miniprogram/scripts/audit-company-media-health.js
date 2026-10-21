// Operator-only read of media states; never returns file URLs, owners or review payloads.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
function read(sql) {
  if (!/^SELECT\s/.test(sql)) throw Error('READ_ONLY_QUERY_REQUIRED');
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
    'db', 'execute', '--read-only', '--sql', sql, '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result;
  try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch (_) {}
  if (run.status !== 0 || result?.error || !Array.isArray(result?.data?.items)) throw Error('MEDIA_HEALTH_READ_FAILED');
  return result.data.items;
}
try {
  if (read('SELECT DATABASE() AS db')[0]?.db !== 'cloudbase-d2g65rqbvee0bd978') throw Error('DATABASE_MISMATCH');
  const [raw] = read(`SELECT COUNT(*) AS assets,
    COALESCE(SUM(a.status='DELETED'),0) AS deletedAssets,
    COALESCE(SUM(a.status='READY'),0) AS readyAssets,
    COALESCE(SUM(a.status='REJECTED' AND a.deleted_at>0),0) AS awaitingStorageCleanup,
    COALESCE(MAX(CASE WHEN a.status='REJECTED' AND a.deleted_at>0
      THEN GREATEST(0,FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000)-a.deleted_at) ELSE 0 END),0) AS oldestCleanupAttemptAgeMs,
    COALESCE(SUM(a.status='PENDING' AND a.committed_at IS NULL),0) AS uncommittedUploads,
    COALESCE(SUM(a.status='PENDING' AND a.committed_at IS NOT NULL AND c.asset_id IS NULL),0) AS committedWithoutSubmission,
    COALESCE(SUM(a.status='PENDING' AND c.status='SUBMITTING' AND NULLIF(TRIM(c.trace_id),'') IS NULL),0) AS submittingWithoutTrace,
    COALESCE(SUM(a.status='PENDING' AND c.status IN ('SUBMITTING','PENDING') AND NULLIF(TRIM(c.trace_id),'') IS NOT NULL),0) AS awaitingVerdictWithTrace,
    COALESCE(SUM(c.status='PENDING' AND NULLIF(TRIM(c.trace_id),'') IS NULL),0) AS pendingWithoutTrace,
    COALESCE(SUM(a.status='PENDING' AND a.committed_at IS NOT NULL AND c.status IN ('PASS','REVIEW','RISKY','ERROR') AND NULLIF(TRIM(c.trace_id),'') IS NOT NULL),0) AS savedVerdictPendingAsset,
    COALESCE(SUM(a.status='PENDING' AND c.status='ERROR' AND c.trace_id IS NULL),0) AS retryableSubmissionFailure,
    COALESCE(SUM(a.status='READY' AND a.purpose<>'ORDER_DELIVERY' AND
      (c.asset_id IS NULL OR c.status<>'PASS' OR NULLIF(TRIM(c.trace_id),'') IS NULL OR c.resolved_at IS NULL)),0) AS readyWithoutAcceptedPass,
    COALESCE(MAX(CASE WHEN a.status='PENDING' AND c.status IN ('SUBMITTING','PENDING')
      THEN GREATEST(0,FLOOR(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000)-c.submitted_at) ELSE 0 END),0) AS oldestAwaitingAgeMs
    FROM media_assets a LEFT JOIN media_security_checks c ON c.asset_id=a.id`);
  const counts = Object.fromEntries(Object.entries(raw).map(([key, value]) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw Error('INVALID_MEDIA_HEALTH_COUNT');
    return [key, number];
  }));
  const report = { checkedAt: new Date().toISOString(), databaseMatched: true, counts, writesPerformed: false,
    scope: 'Single aggregate snapshot. Ages are observations, not timeout permissions. No automatic retries, recovery, deletion or alerts.' };
  fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.artifacts/company-media-health.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (_) { console.error('COMPANY_MEDIA_HEALTH_AUDIT_FAILED'); process.exitCode = 1; }
