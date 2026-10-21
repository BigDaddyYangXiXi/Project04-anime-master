// Read-only deployment inventory. Never fetches or serializes function environment variables.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function query(args){
 const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout:60000});
 if(r.status!==0)throw Error('DEPLOYMENT_INVENTORY_QUERY_FAILED');
 try{const d=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1)).data;if(!Array.isArray(d))throw Error();return d;}catch{throw Error('DEPLOYMENT_INVENTORY_RESPONSE_INVALID');}
}
function main(){
 const functions=[];let complete=false;
 for(let offset=0;offset<1000;offset+=100){
  const rows=query(['fn','list','--limit','100','--offset',String(offset)]);
  for(const row of rows){if(typeof row.name!=='string'||functions.some(f=>f.name===row.name))throw Error('DEPLOYMENT_INVENTORY_DUPLICATE');
   functions.push({name:row.name,runtime:row.runtime,status:row.status,modifiedAt:row.modifyTime});}
  if(rows.length<100){complete=true;break;}
 }
 if(!complete)throw Error('DEPLOYMENT_INVENTORY_TRUNCATED');
 const services=query(['service','list']).map(row=>({path:row.path,target:row.name,type:row.type}));
 const report={checkedAt:new Date().toISOString(),envId:'cloudbase-d2g65rqbvee0bd978',functionsComplete:complete,
  functions:functions.sort((a,b)=>a.name.localeCompare(b.name)),services,
  limitations:['Presence/status only; not source-hash parity, exact configuration, end-to-end acceptance or authorization to enable money actions.']};
 fs.writeFileSync(path.join(root,'.artifacts/company-deployment-inventory.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
try{main();}catch(error){console.error(error.message);process.exitCode=1;}
