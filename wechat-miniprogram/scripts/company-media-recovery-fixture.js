// Operator-only fault injection for the one unattached image created by --review.
// Never used by the application or as a general asset-state administration tool.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixture = require('../.artifacts/company-media-review-runtime.json');
const record = path.join(root, '.artifacts/company-media-recovery-fixture.json');
const id = fixture.assetId;
if (!fixture.ok || fixture.reviewStatus !== 'READY' || !/^asset_[a-f0-9]{32}$/.test(id)) throw Error('INVALID_TEST_FIXTURE');
function query(sql, readOnly = true) {
  const args = [path.join(__dirname, 'cloudbase-company-cli.js'), 'db', 'execute', ...(readOnly ? ['--read-only'] : []), '--sql', sql, '--json'];
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result;
  try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch (_) {}
  if (run.status !== 0 || result?.error || !result?.data) throw Error('FIXTURE_DATABASE_OPERATION_FAILED');
  return result.data;
}
if (query('SELECT DATABASE() AS db').items?.[0]?.db !== 'cloudbase-d2g65rqbvee0bd978') throw Error('DATABASE_MISMATCH');
const references = `(SELECT COUNT(*) FROM accounts WHERE avatar_asset_id='${id}') +
 (SELECT COUNT(*) FROM provider_profiles WHERE notice_image_asset_id='${id}') +
 (SELECT COUNT(*) FROM work_images WHERE asset_id='${id}') +
 ${['provider_catalog_drafts', 'provider_catalog_publications', 'project_aggregates', 'order_aggregates'].map(table => `(SELECT COUNT(*) FROM ${table} WHERE CAST(payload AS CHAR) LIKE '%${id}%')`).join(' + ')}`;
const inspect = () => query(`SELECT a.status, a.original_filename, a.purpose,
 c.status AS verdict, (${references}) AS reference_count,
 SHA2(CONCAT_WS('|',c.trace_id,c.status,c.resolved_at,c.updated_at,COALESCE(c.detail_json,'')),256) AS evidence_hash,
 (c.trace_id IS NOT NULL AND c.resolved_at IS NOT NULL AND a.committed_at IS NOT NULL) AS finalized
 FROM media_assets a JOIN media_security_checks c ON c.asset_id=a.id WHERE a.id='${id}'`).items?.[0];
const current = inspect();
if (!current || current.original_filename !== 'launch-upload-audit.png' || current.purpose !== 'WORK_IMAGE'
  || Number(current.reference_count) !== 0 || current.verdict !== 'PASS' || Number(current.finalized) !== 1) throw Error('FIXTURE_NOT_ISOLATED');
if (process.argv.includes('--inject')) {
  if (fs.existsSync(record)) throw Error('INJECTION_ALREADY_ATTEMPTED; inspect existing state');
  if (current.status !== 'READY') throw Error('FIXTURE_NOT_READY');
  fs.writeFileSync(record, JSON.stringify({ assetId: id, baseline: current, attemptedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  query(`UPDATE media_assets SET status='PENDING' WHERE id='${id}' AND status='READY'
    AND original_filename='launch-upload-audit.png' AND purpose='WORK_IMAGE' AND (${references})=0`, false);
  const after = inspect();
  if (after?.status !== 'PENDING' || after.evidence_hash !== current.evidence_hash) throw Error('INJECTION_NOT_VERIFIED');
  console.log(JSON.stringify({ injected: true, references: 0, verdictPreserved: true }));
} else if (process.argv.includes('--verify')) {
  const baseline = JSON.parse(fs.readFileSync(record));
  const ok = baseline.assetId === id && current.status === 'READY' && current.evidence_hash === baseline.baseline.evidence_hash;
  fs.writeFileSync(record, JSON.stringify({ ...baseline, verifiedAt: new Date().toISOString(), recovered: ok }, null, 2));
  console.log(JSON.stringify({ recovered: ok, references: Number(current.reference_count), verdictPreserved: current.evidence_hash === baseline.baseline.evidence_hash }));
  if (!ok) process.exitCode = 1;
} else console.log(JSON.stringify({ status: current.status, isolated: true, verdict: current.verdict }));
