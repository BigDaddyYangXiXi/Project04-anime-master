// Preserve existing environment variables without emitting their values.
const fs = require('node:fs'), { spawnSync } = require('node:child_process');
const config = JSON.parse(fs.readFileSync('cloudbaserc.json'));
const verify = process.argv.includes('--verify');
const expected = verify ? JSON.parse(fs.readFileSync('.cloudbase-cli-config/registration-v3-deploy.json')) : null;
config.functions = config.functions.filter(fn => ['account-bootstrap','account-api'].includes(fn.name));
for (const fn of config.functions) {
  const run = spawnSync(process.execPath, ['scripts/cloudbase-company-cli.js','api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:fn.name,Namespace:config.envId,ShowCode:'FALSE'}),'--json'], {encoding:'utf8',timeout:60000});
  let data; try { data=JSON.parse(run.stdout.slice(run.stdout.indexOf('{'),run.stdout.lastIndexOf('}')+1)).data; } catch {}
  if(run.status!==0 || !data || data.Status!=='Active') throw Error('FUNCTION_CONFIG_UNCONFIRMED');
  fn.envVariables=Object.fromEntries((data.Environment?.Variables||[]).map(v=>[v.Key,v.Value]));
  if (verify) {
    const previous = expected.functions.find(value => value.name === fn.name)?.envVariables;
    if (!previous || Object.keys(previous).length !== Object.keys(fn.envVariables).length || Object.entries(previous).some(([key,value]) => fn.envVariables[key] !== value)) throw Error('DEPLOYED_ENVIRONMENT_MISMATCH');
  }
  fn.timeout=data.Timeout; fn.memorySize=data.MemorySize;
  if(data.VpcConfig?.VpcId) fn.vpc={vpcId:data.VpcConfig.VpcId,subnetId:data.VpcConfig.SubnetId};
  if(fn.name==='account-bootstrap' && String(fn.envVariables.ACCOUNT_PHONE_HASH_KEY||'').length<32) throw Error('PHONE_KEY_NOT_CONFIGURED');
}
if (!verify) fs.writeFileSync('.cloudbase-cli-config/registration-v3-deploy.json',JSON.stringify(config,null,2),{mode:0o600});
const report = { checkedAt: new Date().toISOString(), verified: verify, prepared:!verify, functions:config.functions.map(f=>f.name),phoneKeyPreserved:true };
if (verify) fs.writeFileSync('.artifacts/registration-v3/deployment-config-check.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
