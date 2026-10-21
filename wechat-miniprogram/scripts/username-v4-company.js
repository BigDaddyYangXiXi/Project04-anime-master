const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),env='cloudbase-d2g65rqbvee0bd978';
function sql(statement){
 const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),'db','execute','--sql',statement,'--json'],{cwd:root,encoding:'utf8',timeout:60000});
 let result;try{result=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1));}catch{}
 if(r.status!==0||!result?.data||result.error)throw Error('SQL_UNCONFIRMED');return result.data.items||[];
}
try{
 if(sql('SELECT DATABASE() AS db')[0]?.db!==env)throw Error('TARGET_MISMATCH');
 const rows=sql('SELECT username FROM accounts WHERE username IS NOT NULL');
 const [count]=sql('SELECT COUNT(*) AS n FROM accounts WHERE username IS NOT NULL');
 if(rows.length!==Number(count.n))throw Error('INCOMPLETE_READ');
 if(rows.some(r=>!/^[\x21-\x7e]{2,12}$/.test(r.username)))throw Error('EXISTING_USERNAME_NEEDS_REVIEW');
 if(new Set(rows.map(r=>r.username.toLowerCase())).size!==rows.length)throw Error('EXISTING_CASE_COLLISION');
 if(process.argv.includes('--apply'))sql(fs.readFileSync(path.join(root,'database/mysql/0035_username_case_and_punctuation.sql'),'utf8'));
 const column=sql("SELECT CHARACTER_MAXIMUM_LENGTH AS maxLength,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' AND COLUMN_NAME='username'")[0];
 const applied=Number(column?.maxLength)===12&&column?.collation==='ascii_general_ci';
 if(process.argv.includes('--apply')&&!applied)throw Error('MIGRATION_NOT_CONFIRMED');
 const result={checkedAt:new Date().toISOString(),ok:true,existingUsernames:rows.length,applied};
 fs.writeFileSync(path.join(root,'.artifacts/username-v4-migration.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){console.error(e.message);process.exitCode=1;}
