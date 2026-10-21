// Read-only company metadata and aggregate counts; no account content or writes.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),env='cloudbase-d2g65rqbvee0bd978';
if(require('../cloudbaserc.json').envId!==env||require('../project.config.json').appid!=='wxc94e1c1b38944511')throw Error('TARGET_MISMATCH');
function read(sql){
 const result=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),'db','execute','--read-only','--sql',sql,'--json'],{cwd:root,encoding:'utf8',timeout:60000});
 let reply;try{reply=JSON.parse(result.stdout.slice(result.stdout.indexOf('{'),result.stdout.lastIndexOf('}')+1));}catch(_){}
 if(result.status!==0||reply?.error||!Array.isArray(reply?.data?.items))throw Error('READ_ONLY_AUDIT_FAILED');
 return reply.data.items;
}
try{
 const [state]=read("SELECT DATABASE() AS db,(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='support_requests') AS supportTable,(SELECT COUNT(*) FROM account_saved_items WHERE saved=1 AND target_type='PROVIDER') AS follows,(SELECT COUNT(*) FROM account_saved_items WHERE saved=1 AND target_type='WORK') AS likes");
 if(state.db!==env)throw Error('DATABASE_MISMATCH');
 const constraints=read("SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='media_assets_purpose_check'");
 const indexes=read("SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='account_saved_items' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
 const plan=read("EXPLAIN SELECT COUNT(*) FROM account_saved_items WHERE target_type='PROVIDER' AND target_id='read_only_absent_probe' AND saved=1");
 const supportSchema=Number(state.supportTable)===1?{
  columns:read("SELECT COLUMN_NAME,DATA_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='support_requests' ORDER BY ORDINAL_POSITION"),
  indexes:read("SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='support_requests' ORDER BY INDEX_NAME,SEQ_IN_INDEX"),
  constraints:read("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN (SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='support_requests' AND CONSTRAINT_TYPE='CHECK')"),
  rows:Number(read('SELECT COUNT(*) AS total FROM support_requests')[0].total)
 }:null;
 const report={checkedAt:new Date().toISOString(),databaseMatched:true,supportTablePresent:Number(state.supportTable)===1,supportImagePurposePresent:constraints.some(c=>c.CHECK_CLAUSE.includes('SUPPORT_IMAGE')),savedCounts:{follows:Number(state.follows),likes:Number(state.likes)},savedIndexes:indexes,followCountPlan:plan,scope:'Management SQL read-only. Does not verify RDB HEAD gateway, per-user identity, migration permission or native UI.'};
 report.supportSchema=supportSchema;
 fs.writeFileSync(path.join(root,'.artifacts/me-service-readiness.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(error.message);process.exitCode=1;}
