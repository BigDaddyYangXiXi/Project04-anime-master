// Operator-only check: fixed literals and system metadata, no user records or writes.
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sql = `SELECT DATABASE() AS db, VERSION() AS version,
  (SELECT COUNT(*) FROM information_schema.COLLATIONS WHERE COLLATION_NAME = 'utf8mb4_0900_bin') AS binaryCollationAvailable,
  jt.ordinal, jt.work_id
  FROM JSON_TABLE(CAST('[{"id":"sample"}]' AS JSON), '$[*]'
    COLUMNS (ordinal FOR ORDINALITY, work_id VARCHAR(64) PATH '$.id')) jt`;
const result = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
  'db', 'execute', '--read-only', '--sql', sql, '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
let reply;
try { reply = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'), result.stdout.lastIndexOf('}') + 1)); } catch (_) {}
if (result.status !== 0 || reply?.error || !Array.isArray(reply?.data?.items)) throw Error('CATALOG_SQL_CAPABILITY_READ_FAILED');
const row = reply.data.items[0];
if (row?.db !== 'cloudbase-d2g65rqbvee0bd978') throw Error('DATABASE_MISMATCH');
const candidate = require('./catalog-publication-query').publishedWorkCandidatesQuery({ mode: 'works', cityCode: '310000', career: '摄影', priceMinFen: 0, priceMaxFen: 100 });
// Fixed public probe values only; production callers must retain parameter binding.
let index = 0;
const candidateSql = candidate.sql.replace(/\?/g, () => {
  const value = candidate.values[index++];
  if (Number.isSafeInteger(value)) return String(value);
  if (typeof value !== 'string' || !/^[0-9\u4e00-\u9fff]+$/.test(value)) throw Error('UNEXPECTED_PROBE_VALUE');
  return "'" + value + "'";
});
const explained = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
  'db', 'execute', '--read-only', '--sql', 'EXPLAIN FORMAT=JSON ' + candidateSql, '--json'],
  { cwd: root, encoding: 'utf8', timeout: 60000 });
let plan;
try { plan = JSON.parse(explained.stdout.slice(explained.stdout.indexOf('{'), explained.stdout.lastIndexOf('}') + 1)); } catch (_) {}
if (explained.status !== 0 || plan?.error || !plan?.data?.items?.length) throw Error('CATALOG_SQL_EXPLAIN_FAILED');
fs.writeFileSync(path.join(root, '.artifacts/catalog-candidate-explain-20261007.json'), JSON.stringify(plan.data.items, null, 2));
const report = { checkedAt: new Date().toISOString(), databaseMatched: true, version: row.version,
  binaryCollationAvailable: Number(row.binaryCollationAvailable) === 1,
  jsonTableAvailable: row.work_id === 'sample' && Number(row.ordinal) === 1,
  candidateExplainPassed: true,
  scope: 'Operator CLI only; does not prove cloud function SQL connectivity or permission.' };
fs.writeFileSync(path.join(root, '.artifacts/catalog-sql-capabilities-20261007.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
