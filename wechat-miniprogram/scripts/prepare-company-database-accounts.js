const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const database = 'cloudbase-d2g65rqbvee0bd978';
const host = '172.17.0.0/255.255.240.0';
const grants = {
  am_payment: { accounts: 'SELECT', wechat_identities: 'SELECT', account_roles: 'SELECT',
    provider_payment_merchants: 'SELECT', order_aggregates: 'SELECT, UPDATE', order_payments: 'SELECT, INSERT, UPDATE' },
  am_order: { accounts: 'SELECT', provider_qualifications: 'SELECT', order_aggregates: 'SELECT, UPDATE' }
};

function sql(statement, readOnly = false) {
  const args = [path.join(__dirname, 'cloudbase-company-cli.js'), 'db', 'execute', '--sql', statement, '--json'];
  if (readOnly) args.push('--read-only');
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  let result;
  try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch {}
  // SQL may contain generated passwords; never emit the CLI's raw error/output.
  if (run.status !== 0 || !result || result.error) throw Error('DATABASE_ACCOUNT_OPERATION_FAILED');
  return result.data;
}

function main() {
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ database, host, grants, applied: false })); return; }
  const secretFile = path.join(root, '.cloudbase-cli-config/company-database-accounts.json');
  if (fs.existsSync(secretFile)) throw Error('ACCOUNT_PREPARATION_ALREADY_EXISTS_REVIEW_BEFORE_RESUMING');
  const identity = sql('SELECT DATABASE() AS db, CURRENT_USER() AS actor', true);
  if (identity?.items?.[0]?.db !== database || identity.items[0].actor !== 'root@%') throw Error('DATABASE_ADMIN_TARGET_MISMATCH');
  const existing = sql("SELECT COUNT(*) AS account_count FROM mysql.user WHERE User IN ('am_payment','am_order')", true);
  if (Number(existing?.items?.[0]?.account_count) !== 0) throw Error('ACCOUNT_ALREADY_EXISTS_REVIEW_REQUIRED');
  const secrets = Object.fromEntries(Object.keys(grants).map(user => [user, {
    transport: 'company-vpc', host: '172.17.0.13', port: 3306, database, user,
    password: `Aa1!${crypto.randomBytes(24).toString('hex')}`
  }]));
  fs.writeFileSync(secretFile, JSON.stringify(secrets, null, 2), { flag: 'wx', mode: 0o600 });
  for (const [user, tables] of Object.entries(grants)) {
    const account = `'${user}'@'${host}'`;
    sql(`CREATE USER ${account} IDENTIFIED BY '${secrets[user].password}'`);
    console.log(`${user}: created`);
    for (const [table, privileges] of Object.entries(tables)) {
      sql(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO ${account}`);
      console.log(`${user}: ${table} granted`);
    }
  }
  console.log('Dedicated accounts prepared; passwords not printed. Verify grants and private connections separately.');
}
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}
