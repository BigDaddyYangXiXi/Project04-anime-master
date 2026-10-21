const fs=require('node:fs');
const path=require('node:path');
async function main(){
 const base='http://127.0.0.1:9433';
 const html=await (await fetch(base)).text();
 const token=html.match(/const token="([a-f0-9]+)"/)[1];
 const data=await (await fetch(base+'/fixtures.json')).json();
 const start=Number(process.argv[2]||0),count=Number(process.argv[3]||10);
 let failed=0;
 for(const scene of data.scenarios.slice(start,start+count)){
  const res=await fetch(base+'/open',{method:'POST',headers:{'Content-Type':'application/json','X-State-Lab':token},body:JSON.stringify({id:scene.id,capture:process.argv[4]==='capture'})});
  const result=await res.json();
  fs.appendFileSync(path.resolve(__dirname,'../.artifacts/state-lab/checks.jsonl'),JSON.stringify({id:scene.id,passed:res.ok,result})+'\n');
  console.log(scene.id+' '+(res.ok?'通过':'失败 '+result.error));if(!res.ok)failed++;
 }
 if(failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1});
