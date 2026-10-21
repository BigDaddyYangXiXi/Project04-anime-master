const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { inspectPaymentSchema } = require('../automation/mysql-readonly-preflight');
const database = 'cloudbase-d2g65rqbvee0bd978';
function read(sql) {
  if (!/^SELECT\s/i.test(sql)) throw Error('READ_ONLY_QUERY_REQUIRED');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'),
    'db', 'execute', '--read-only', '--sql', sql, '--json'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  let result;
  try { result = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)); } catch {}
  if (r.status !== 0 || !result?.data || result.error) throw Error('SCHEMA_READ_FAILED');
  return result.data.items || [];
}
async function main() {
  const [identity] = read('SELECT DATABASE() AS db');
  if (identity?.db !== database) throw Error('DATABASE_MISMATCH');
  const schema = await inspectPaymentSchema({ async execute(sql, params) {
    let i = 0;
    const rendered = sql.replace(/\?/g, () => {
      const value = params[i++];
      if (typeof value !== 'string' || !/^[a-z0-9_-]+$/.test(value)) throw Error('METADATA_PARAMETER_INVALID');
      return `'${value}'`;
    });
    if (i !== params.length) throw Error('METADATA_PARAMETER_INVALID');
    return [read(rendered)];
  } }, database);
  const counts = read('SELECT (SELECT COUNT(*) FROM order_aggregates) AS orders, (SELECT COUNT(*) FROM order_payments) AS payments, (SELECT COUNT(*) FROM order_settlement_tasks) AS settlements')[0];
  const ok = !schema.columnIssues.length && !schema.indexIssues.length;
  console.log(JSON.stringify({ ok, databaseMatched: true, ...schema, counts,
    scope: 'Selected schema requirements and counts only; not runtime permission or business acceptance.' }));
  if (!ok) process.exitCode = 1;
}
main().catch(() => { console.error('COMPANY_SCHEMA_AUDIT_FAILED'); process.exitCode = 1; });
