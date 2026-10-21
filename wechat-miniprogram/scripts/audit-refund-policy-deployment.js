// Read-only metadata and anonymous rejection. Never prints function environment values.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),envId='cloudbase-d2g65rqbvee0bd978';
function cli(args){
  const r=spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout:60000});
  let parsed;try{parsed=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1));}catch{}
  if(r.status!==0||!parsed?.data||parsed.error)throw Error('AUDIT_FAILED');return parsed.data;
}
try{
  const results=[];
  for(const [name,file,action] of [
    ['order-api','company-order-public-deploy.json','transitionOrder'],
    ['payment-api','merchant-configured-closed/payment-api.json','requestRefund']]){
    const expected=JSON.parse(fs.readFileSync(path.join(root,'.cloudbase-cli-config',file)));
    assert.equal(expected.envId,envId);
    const fn=expected.functions.find(f=>f.name===name);
    const current=cli(['api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ShowCode:'FALSE'})]);
    assert.equal(current.Status,'Active');assert.equal(current.Handler,fn.handler);assert.equal(current.Runtime,fn.runtime);
    const env=Object.fromEntries(current.Environment.Variables.map(v=>[v.Key,v.Value]));
    assert.deepEqual(env,fn.envVariables);
    if(name==='payment-api'){
      const config=JSON.parse(Buffer.from(env.PAYMENT_WECHAT_CONFIG_B64,'base64').toString('utf8'));
      for(const key of ['prepayEnabled','refundEnabled','refundRequestsEnabled','settlementEnabled','settlementExecutionEnabled'])assert.notEqual(config[key],true);
    }
    const invoked=cli(['api','scf','Invoke','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:name,Namespace:envId,ClientContext:JSON.stringify({action}),LogType:'None'})]);
    const reply=JSON.parse(invoked.Result.RetMsg);assert.equal(reply.ok,false);assert.equal(reply.error.code,'AUTH_CONTEXT_MISSING');
    results.push({name,status:current.Status,runtime:current.Runtime,modifiedAt:current.ModTime,configurationUnchanged:true,anonymousRejected:true});
  }
  const report={checkedAt:new Date().toISOString(),results,moneySwitchesClosed:true,authenticatedFlowVerified:false};
  fs.writeFileSync(path.join(root,'.artifacts/refund-policy-live-audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}catch{console.error('REFUND_POLICY_DEPLOYMENT_AUDIT_FAILED');process.exitCode=1;}
