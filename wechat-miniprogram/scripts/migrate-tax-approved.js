// User authorized this exact migration and grant scope on 2026-09-27.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const database = 'cloudbase-d2g65rqbvee0bd978';
const tables = ['tax_assessment_drafts','provider_tax_profile_versions','provider_tax_profile_reviews','provider_tax_submissions'];
const files = ['0044_tax_assessment_drafts.sql','0045_provider_tax_profile_versions.sql','0046_tax_profile_reviews.sql',
  '0047_tax_profile_submissions.sql','0048_tax_profile_submission_link.sql'];
function sql(statement, readonly = false) {
  const args = [path.join(__dirname,'cloudbase-company-cli.js'),'db','execute','--sql',statement,'--json'];
  if (readonly) args.push('--read-only');
  const result = spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:60000});
  let data;
  try { data = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'),result.stdout.lastIndexOf('}')+1)); } catch {}
  if (result.status !== 0 || !data?.data || data.error) throw Error('TAX_MIGRATION_SQL_FAILED');
  return data.data.items || [];
}
function main() {
  if (!process.argv.includes('--apply')) throw Error('EXPLICIT_APPLY_REQUIRED');
  const [identity] = sql('SELECT DATABASE() AS db,CURRENT_USER() AS actor',true);
  if (identity?.db !== database || identity.actor !== 'root@%') throw Error('ADMIN_TARGET_MISMATCH');
  const accounts = sql("SELECT Host FROM mysql.user WHERE User='am_payment'",true);
  if (accounts.length !== 1 || accounts[0].Host !== '172.17.0.0/255.255.240.0') throw Error('PAYMENT_ACCOUNT_REVIEW_REQUIRED');
  const [existing] = sql(`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_NAME IN (${tables.map(t=>`'${t}'`).join(',')})`,true);
  if (Number(existing?.n) !== 0) throw Error('EXISTING_OR_PARTIAL_MIGRATION_REVIEW_REQUIRED');
  const report = { database, startedAt:new Date().toISOString(), completedFiles:[], grants:[], completed:false };
  const reportPath = path.join(root,'.artifacts/tax-approved-migration-2026-09-27.json');
  const save = () => fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  save();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root,'database/mysql',file),'utf8');
    for (const statement of source.replace(/^\s*--.*$/gm,'').split(';').filter(s=>s.trim())) sql(statement);
    report.completedFiles.push(file); save();
    console.log(JSON.stringify({ migrated:file }));
  }
  const account = "'am_payment'@'172.17.0.0/255.255.240.0'";
  for (const [table,privileges] of [['provider_tax_submissions','SELECT, INSERT, UPDATE (id)'],['provider_tax_profile_versions','SELECT']]) {
    sql(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO ${account}`);
    report.grants.push({table,privileges}); save();
  }
  report.tablePrivileges = sql(`SELECT Table_name,Table_priv,Column_priv FROM mysql.tables_priv WHERE Db='${database}' AND User='am_payment' AND Host='172.17.0.0/255.255.240.0' AND Table_name IN (${tables.map(t=>`'${t}'`).join(',')})`,true);
  report.columnPrivileges = sql(`SELECT Table_name,Column_name,Column_priv FROM mysql.columns_priv WHERE Db='${database}' AND User='am_payment' AND Host='172.17.0.0/255.255.240.0' AND Table_name IN (${tables.map(t=>`'${t}'`).join(',')})`,true);
  report.completed = true; report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify(report));
}
try { main(); } catch(error) { console.error(error.message); process.exitCode=1; }
