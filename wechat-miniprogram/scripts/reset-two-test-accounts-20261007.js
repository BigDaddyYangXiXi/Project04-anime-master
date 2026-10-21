// One-off reset explicitly requested by the owner. No schema, permission or payment changes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(path.join(root, '.artifacts/reset-two-test-accounts-plan-20261007.json')));
const ids = ['acct_5f1f7ff84d978e6ae974b2732f3b682d', 'acct_11dd26b835a586ce565e2b4d14de8c36'];
assert.deepEqual(plan.ids, ids);
if (!process.argv.includes('--execute-authorized-reset')) throw Error('EXPLICIT_EXECUTION_REQUIRED');
const values = "('" + ids.join("','") + "')";
function cli(args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'cloudbase-company-cli.js'), ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  let result; try { result = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)); } catch (_) {}
  if (r.status !== 0 || result?.error || !result?.data) throw Error('RESET_OPERATION_FAILED');
  return result.data;
}
function sql(text, write = false) { return cli(['db', 'execute', ...(write ? [] : ['--read-only']), '--sql', text, '--json']); }
assert.equal(sql('SELECT DATABASE() AS db').items[0].db, 'cloudbase-d2g65rqbvee0bd978');
assert.deepEqual(sql('SELECT id FROM accounts ORDER BY id').items.map(x => x.id), [...ids].sort());
const funds = ['order_aggregates', 'order_payments', 'order_refunds', 'order_settlement_tasks', 'fund_journals', 'fund_postings'];
for (const row of sql(funds.map(t => `SELECT '${t}' AS name, COUNT(*) AS n FROM ${t}`).join(' UNION ALL ')).items) assert.equal(Number(row.n), 0, row.name);
const assets = sql(`SELECT id,owner_account_id,storage_key,status FROM media_assets WHERE owner_account_id IN ${values} ORDER BY id`).items;
assert.deepEqual(assets, [...plan.assets].sort((a,b) => a.id.localeCompare(b.id)));
const paths = assets.map(a => {
  let value = a.storage_key;
  if (value.startsWith('cloud://')) {
    const match = /^cloud:\/\/cloudbase-d2g65rqbvee0bd978\.[A-Za-z0-9_-]+\/(.+)$/.exec(value);
    if (!match) throw Error('FILE_ENVIRONMENT_MISMATCH'); value = match[1];
  }
  if (!value.startsWith('user-uploads/' + a.owner_account_id + '/') || !/^user-uploads\/[A-Za-z0-9_./-]+$/.test(value)
    || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('FILE_SCOPE_MISMATCH');
  return value;
});
sql(`UPDATE accounts SET status='SUSPENDED', version=version+1, updated_at=${Date.now()} WHERE id IN ${values} AND status='ACTIVE'`, true);
assert.equal(sql(`SELECT COUNT(*) AS n FROM accounts WHERE id IN ${values} AND status='SUSPENDED'`).items[0].n, 2);
const listFiles = () => ids.flatMap(id => cli(['storage', 'list', 'user-uploads/' + id + '/', '--json']));
const beforeFiles = listFiles();
if (beforeFiles.length) cli(['storage', 'rm', ...paths, '--force', '--json']);
assert.equal(listFiles().length, 0, 'Account storage prefix must be empty before removing metadata');
const deletedFiles = { verifiedAccountPrefixesEmpty: true };
for (const [table, column] of [['project_aggregates','buyer_id'], ['provider_catalog_drafts','provider_id'],
  ['provider_catalog_publications','provider_id'], ['provider_profiles','provider_id'], ['media_assets','owner_account_id']]) {
  sql(`DELETE FROM ${table} WHERE ${column} IN ${values}`, true);
}
sql(`DELETE FROM accounts WHERE id IN ${values}`, true);
const tables = ['accounts','wechat_identities','account_phone_identities','account_registration_consents','account_roles',
  'account_discovery_preferences','account_saved_items','provider_catalog_drafts','provider_catalog_publications','project_aggregates','media_assets','media_security_checks'];
const remaining = sql(tables.map(t => `SELECT '${t}' AS name, COUNT(*) AS n FROM ${t}`).join(' UNION ALL ')).items;
for (const row of remaining) assert.equal(Number(row.n), 0, row.name);
const report = { completedAt: new Date().toISOString(), accountsReset: 2, targetedMediaRecords: assets.length,
  storageDeletion: deletedFiles, remainingFiles: 0, remaining, localStorageCleared: false };
fs.writeFileSync(path.join(root, '.artifacts/reset-two-test-accounts-result-20261007.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({accountsReset:2,targetedMediaRecords:assets.length,remainingFiles:0,remaining}));
