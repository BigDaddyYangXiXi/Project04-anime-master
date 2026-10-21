// Exact company notification account only. Never emits SQL containing credentials.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const database = 'cloudbase-d2g65rqbvee0bd978';
const account = "'am_notification'@'172.17.0.0/255.255.240.0'";
const grants = { accounts: 'SELECT', wechat_identities: 'SELECT', order_aggregates: 'SELECT',
  wechat_subscription_events: 'SELECT', order_notification_receipts: 'SELECT, INSERT, UPDATE' };
function sql(statement) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), 'db', 'execute', '--sql', statement, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result;
  try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch {}
  if (run.status !== 0 || !result?.data || result.error) throw Error('NOTIFICATION_ACCOUNT_OPERATION_UNCONFIRMED');
  return result.data.items || [];
}
function main() {
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ account, database, grants, applied: false })); return; }
  if (require('../project.config.json').appid !== 'wxc94e1c1b38944511' || require('../cloudbaserc.json').envId !== database) throw Error('TARGET_MISMATCH');
  const secrets = JSON.parse(fs.readFileSync(path.join(root, '.cloudbase-cli-config/company-notification-secrets.json'), 'utf8'));
  const config = secrets.database;
  if (secrets.env !== database || config.user !== 'am_notification' || config.database !== database
    || !/^Aa1![a-f0-9]{48}$/.test(config.password)) throw Error('SECRET_CONFIG_MISMATCH');
  const [identity] = sql('SELECT DATABASE() AS db');
  if (identity?.db !== database) throw Error('DATABASE_MISMATCH');
  const [existing] = sql("SELECT COUNT(*) AS n FROM mysql.user WHERE User='am_notification'");
  if (Number(existing?.n) !== 0) throw Error('ACCOUNT_EXISTS_REVIEW_REQUIRED');
  const tables = sql('SHOW TABLES').map(row => Object.values(row)[0]);
  if (Object.keys(grants).some(table => !tables.includes(table))) throw Error('REQUIRED_TABLE_MISSING');
  sql(`CREATE USER ${account} IDENTIFIED BY '${config.password}'`);
  for (const [table, permissions] of Object.entries(grants)) sql(`GRANT ${permissions} ON \`${database}\`.\`${table}\` TO ${account}`);
  const actual = sql(`SHOW GRANTS FOR ${account}`).map(row => Object.values(row)[0]);
  const expected = Object.entries(grants).map(([table, permissions]) =>
    `GRANT ${permissions} ON \`${database}\`.\`${table}\` TO \`am_notification\`@\`172.17.0.0/255.255.240.0\``);
  const usage = 'GRANT USAGE ON *.* TO `am_notification`@`172.17.0.0/255.255.240.0`';
  if (actual.length !== expected.length + 1 || !actual.includes(usage) || expected.some(line => !actual.includes(line))) throw Error('GRANTS_REQUIRE_REVIEW');
  const result = { ok: true, checkedAt: new Date().toISOString(), account, database, grants, scope: 'Exact grants only; private connection not yet tested.' };
  fs.writeFileSync(path.join(root, '.artifacts/company-notification-account.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
