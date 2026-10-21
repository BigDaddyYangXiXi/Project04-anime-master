// One authenticated targeted run against an already-DELETED test asset.
// Writes one cleanup audit row, never deliberately supplies an eligible asset.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.artifacts/company-media-cleanup-noop.json');
function cli(args) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), ...args],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  if (run.status !== 0) throw Error('CLEANUP_NOOP_CALL_FAILED');
  const response = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1));
  if (response.error || !response.data) throw Error('CLEANUP_NOOP_RESPONSE_INVALID');
  return response.data;
}
function read(sql) { return cli(['db', 'execute', '--read-only', '--sql', sql, '--json']).items; }
try {
  if (fs.existsSync(output)) throw Error('CLEANUP_NOOP_ALREADY_ATTEMPTED');
  const config = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-media-cleanup-deploy.json'), 'utf8'));
  if (config.envId !== 'cloudbase-d2g65rqbvee0bd978' || read('SELECT DATABASE() AS db')[0]?.db !== config.envId) throw Error('ENVIRONMENT_MISMATCH');
  const token = config.functions.find(fn => fn.name === 'media-pending-cleanup')?.envVariables?.MEDIA_CLEANUP_TOKEN;
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw Error('CLEANUP_TOKEN_INVALID');
  const previous = JSON.parse(fs.readFileSync(path.join(root, '.artifacts/company-media-uncommitted-cancel-runtime.json'), 'utf8'));
  if (previous.ok !== true || previous.cleaned !== true || !/^asset_[a-f0-9]{32}$/.test(previous.assetId)) throw Error('TEST_ASSET_NOT_CONFIRMED');
  const assetId = previous.assetId;
  const query = `SELECT status FROM media_assets WHERE id='${assetId}'`;
  const rows = read(query);
  if (rows.length !== 1 || rows[0].status !== 'DELETED') throw Error('TARGET_NOT_DELETED');
  const report = { startedAt: new Date().toISOString(), attempted: true, done: false, assetId };
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  const result = JSON.parse(cli(['fn', 'invoke', 'media-pending-cleanup', '-d',
    JSON.stringify({ assetId, cleanupToken: token }), '--json']).RetMsg);
  if (result.ok !== true || !/^mcr_[a-f0-9]{32}$/.test(result.data?.audit?.runId || '')) throw Error('CLEANUP_NOOP_FAILED');
  report.runId = result.data.audit.runId;
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  const audit = read(`SELECT source,status,pending_summary,ready_orphan_summary,error_code FROM media_cleanup_runs WHERE id='${report.runId}'`)[0];
  const pending = typeof audit?.pending_summary === 'string' ? JSON.parse(audit.pending_summary) : audit?.pending_summary;
  const zero = value => value && ['scanned', 'eligible', 'deleted', 'skipped', 'failed'].every(key => value[key] === 0);
  const checks = { targetStillDeleted: read(query)[0]?.status === 'DELETED', noCandidates: zero(result.data.pending),
    readyScanSkipped: result.data.readyOrphans === null, auditAcknowledged: result.data.audit.saved === true,
    auditPersisted: audit?.source === 'TARGET' && audit.status === 'SUCCESS' && audit.error_code === null
      && audit.ready_orphan_summary === null && zero(pending) };
  Object.assign(report, { checkedAt: new Date().toISOString(), done: true, ok: Object.values(checks).every(Boolean), checks,
    scope: 'Already-deleted test asset only. One cleanup audit row; no eligible file deletion or READY scan.' });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checkedAt: report.checkedAt, ok: report.ok, checks }));
  if (!report.ok) process.exitCode = 1;
} catch { console.error('COMPANY_MEDIA_CLEANUP_NOOP_NOT_COMPLETED; inspect saved attempt before retry'); process.exitCode = 1; }
