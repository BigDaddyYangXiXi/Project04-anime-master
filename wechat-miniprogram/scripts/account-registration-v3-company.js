// Company schema migration and explicitly authorized test account reset. Never clears business tables.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { nicknameKey } = require('../server-shared/account-names');
const root = path.resolve(__dirname, '..'), env = 'cloudbase-d2g65rqbvee0bd978';
const target = 'acct_5f1f7ff84d978e6ae974b2732f3b682d';
const out = path.join(root, '.artifacts/registration-v3'); fs.mkdirSync(out, { recursive: true });
function sql(statement) {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), 'db', 'execute', '--sql', statement, '--json'], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result; try { result = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)); } catch {}
  if (run.status !== 0 || !result?.data || result.error) throw Error('COMPANY_SQL_UNCONFIRMED');
  return result.data.items || [];
}
function main() {
  if (require('../cloudbaserc.json').envId !== env || sql('SELECT DATABASE() AS db')[0]?.db !== env) throw Error('TARGET_MISMATCH');
  const [count] = sql('SELECT COUNT(*) AS n FROM accounts');
  const accounts = sql('SELECT id,nickname,status,uid,version FROM accounts');
  if (accounts.length !== Number(count.n)) throw Error('INCOMPLETE_ACCOUNT_SCAN');
  const keys = accounts.map(a => nicknameKey(a.nickname));
  if (new Set(keys).size !== keys.length) throw Error('LEGACY_NICKNAME_COLLISION_REQUIRES_REVIEW');
  if (accounts.some(a => !/^acct_[a-f0-9]{32}$/.test(a.id))) throw Error('UNEXPECTED_ACCOUNT_ID');
  const mode = process.argv[2] || '--check';
  if (mode === '--migrate') {
    const existing = sql("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' AND COLUMN_NAME='username'");
    if (existing.length) throw Error('MIGRATION_ALREADY_PRESENT_REVIEW_REQUIRED');
    fs.writeFileSync(path.join(out, 'accounts-before.json'), JSON.stringify(accounts, null, 2), { flag: 'wx' });
    const statements = fs.readFileSync(path.join(root, 'database/mysql/0034_account_registration_identity.sql'), 'utf8').split(/;\s*(?:\r?\n|$)/).filter(s => s.trim());
    for (const statement of statements) sql(statement);
    for (const a of accounts) sql(`UPDATE accounts SET nickname_key='${nicknameKey(a.nickname)}' WHERE id='${a.id}' AND version=${Number(a.version)}`);
    const [missing] = sql('SELECT COUNT(*) AS n FROM accounts WHERE nickname_key IS NULL');
    if (Number(missing.n)) throw Error('NICKNAME_BACKFILL_INCOMPLETE');
  } else if (mode === '--reset-test-account') {
    const account = accounts.find(a => a.id === target);
    if (!account || account.nickname !== '站长是虹口麻将皇帝' || account.status !== 'ACTIVE' || account.uid !== 'AM_5F1F7FF84D97') throw Error('RESET_TARGET_STATE_CHANGED');
    const backup = { account: sql(`SELECT * FROM accounts WHERE id='${target}'`), phone: sql(`SELECT * FROM account_phone_identities WHERE account_id='${target}'`) };
    fs.writeFileSync(path.join(out, 'authorized-test-reset-before.json'), JSON.stringify(backup, null, 2), { flag: 'wx' });
    sql(`UPDATE accounts SET status='PENDING',registration_version=0,username=NULL,registration_phone_fingerprint=NULL,version=version+1,updated_at=${Date.now()} WHERE id='${target}' AND status='ACTIVE' AND version=${Number(account.version)}`);
    const [pending] = sql(`SELECT status,registration_version FROM accounts WHERE id='${target}'`);
    if (pending?.status !== 'PENDING' || Number(pending.registration_version) !== 0) throw Error('RESET_NOT_CONFIRMED');
    sql(`DELETE FROM account_phone_identities WHERE account_id='${target}'`);
    const [remaining] = sql(`SELECT COUNT(*) AS n FROM account_phone_identities WHERE account_id='${target}'`);
    if (Number(remaining.n)) throw Error('RESET_PHONE_NOT_CONFIRMED');
  } else if (mode !== '--check') throw Error('UNSUPPORTED_MODE');
  const report = { checkedAt: new Date().toISOString(), env, mode, accountCount: accounts.length, nicknameCollisions: 0, ok: true };
  fs.writeFileSync(path.join(out, mode.slice(2) + '.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
