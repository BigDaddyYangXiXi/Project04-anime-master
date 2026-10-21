// Saves only the existing media schema and verifies the exact additive migration baseline.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function read(sql){const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),'db','execute','--read-only','--sql',sql,'--json'],{cwd:root,encoding:'utf8',timeout:60000});let j;try{j=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1));}catch(_){}if(r.status!==0||j?.error||!j?.data?.items)throw Error('SCHEMA_READ_FAILED');return j.data.items;}
try{
 const [state]=read("SELECT DATABASE() AS db,(SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='support_requests') AS supportTable");
 if(state.db!=='cloudbase-d2g65rqbvee0bd978'||Number(state.supportTable)!==0)throw Error('BASELINE_CHANGED');
 const [constraint]=read("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='media_assets_purpose_check'");
 const purposes=[...constraint.CHECK_CLAUSE.replace(/\\'/g, "'").matchAll(/'([^']+)'/g)].map(m=>m[1]).sort();
 if(JSON.stringify(purposes)!==JSON.stringify(['AVATAR','NOTICE_IMAGE','WORK_IMAGE','PROJECT_REFERENCE','PROJECT_TARGET','ORDER_DELIVERY'].sort()))throw Error('MEDIA_PURPOSE_BASELINE_CHANGED');
 const [table]=read('SHOW CREATE TABLE media_assets');
 const file=path.join(root,'database/mysql/0055_support_requests.sql'),hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const dir=path.join(root,'.artifacts/support-schema-before-20261007');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'media_assets.sql'),table['Create Table']+';\n');
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({checkedAt:new Date().toISOString(),database:state.db,migration:'0055_support_requests.sql',sha256:hash,purposes,supportTablePresent:false,scope:'Schema only, no user rows or permissions captured. Not a full data backup.'},null,2));
 console.log(JSON.stringify({baselineMatched:true,schemaSaved:true,sha256:hash}));
}catch(e){console.error(e.message);process.exitCode=1;}
