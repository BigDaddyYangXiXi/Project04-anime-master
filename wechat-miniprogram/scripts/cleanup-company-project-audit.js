// Deletes only the completed, unchanged, empty project from the write audit.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const file = path.join(root, process.argv.includes('--concurrent') ? '.artifacts/company-project-concurrent-runtime.json' : '.artifacts/company-project-write-runtime.json');
const audit = JSON.parse(fs.readFileSync(file));
if (!audit.persisted || !audit.staleRejected || !/^prj_[a-f0-9]{32}$/.test(audit.projectId)
  || !/^launch-project-audit-[a-f0-9-]{36}$/.test(audit.requestKey) || audit.version !== 2) throw Error('INVALID_TEST_PROJECT');
function query(sql, readOnly = true) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), 'db', 'execute',
    ...(readOnly ? ['--read-only'] : []), '--sql', sql, '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result;
  try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch (_) {}
  if (run.status !== 0 || result?.error || !result?.data) throw Error('TEST_PROJECT_CLEANUP_QUERY_FAILED');
  return result.data;
}
if (query('SELECT DATABASE() AS db').items?.[0]?.db !== 'cloudbase-d2g65rqbvee0bd978') throw Error('DATABASE_MISMATCH');
const key = `id='${audit.projectId}' AND create_idempotency_key='${audit.requestKey}'`;
const condition = `${key} AND version=2
 AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.title'))='上线验收测试项目（自动清理）'
 AND JSON_LENGTH(JSON_EXTRACT(payload,'$.bookingIds'))=0
 AND JSON_LENGTH(JSON_EXTRACT(payload,'$.targetImages'))=0
 AND NOT EXISTS (SELECT 1 FROM order_aggregates WHERE CAST(payload AS CHAR) LIKE '%${audit.projectId}%')`;
const count = query(`SELECT COUNT(*) AS count FROM project_aggregates WHERE ${condition}`).items?.[0]?.count;
if (Number(count) !== 1) throw Error('TEST_PROJECT_CHANGED_OR_MISSING');
query(`DELETE FROM project_aggregates WHERE ${condition}`, false);
const remaining = Number(query(`SELECT COUNT(*) AS count FROM project_aggregates WHERE ${key}`).items?.[0]?.count);
if (remaining !== 0) throw Error('TEST_PROJECT_CLEANUP_NOT_CONFIRMED');
fs.writeFileSync(file, JSON.stringify({ ...audit, cleaned: true, cleanedAt: new Date().toISOString() }, null, 2));
console.log(JSON.stringify({ cleaned: true, remaining: 0 }));
