// Read-only post-deployment metadata and anonymous rejection probes. Never prints env values.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname,'..'), envId = 'cloudbase-d2g65rqbvee0bd978';
function cli(args) {
  const r = spawnSync(process.execPath,[path.join(__dirname,'cloudbase-company-cli.js'),...args,'--json'],{cwd:root,encoding:'utf8',timeout:60000});
  let result; try { result=JSON.parse(r.stdout.slice(r.stdout.indexOf('{'),r.stdout.lastIndexOf('}')+1)); } catch {}
  if(r.status!==0 || !result?.data || result.error) throw Error('TAX_DEPLOYMENT_AUDIT_FAILED');
  return result.data;
}
try {
  const expected=JSON.parse(fs.readFileSync(path.join(root,'.cloudbase-cli-config/merchant-configured-closed/payment-api.json'),'utf8'));
  const fn=expected.functions.find(f=>f.name==='payment-api'); assert.equal(expected.envId,envId);
  const current=cli(['api','scf','GetFunction','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:'payment-api',Namespace:envId,ShowCode:'FALSE'})]);
  assert.equal(current.Status,'Active'); assert.equal(current.Handler,'index.main');
  const env=Object.fromEntries(current.Environment.Variables.map(v=>[v.Key,v.Value]));
  assert.deepEqual(env,fn.envVariables);
  const config=JSON.parse(Buffer.from(env.PAYMENT_WECHAT_CONFIG_B64,'base64').toString('utf8'));
  for(const key of ['taxSubmissionEnabled','prepayEnabled','refundEnabled','refundRequestsEnabled','settlementEnabled','settlementExecutionEnabled']) assert.notEqual(config[key],true);
  assert.equal(env.TAX_PROFILE_CONFIG,undefined); assert.equal(env.TAX_PROFILE_CONFIG_B64,undefined);
  const tables=['tax_assessment_drafts','provider_tax_profile_versions','provider_tax_profile_reviews','provider_tax_submissions'];
  const permissions=cli(['api','tcb','DescribeResourcePermission','--body',JSON.stringify({EnvId:envId,ResourceType:'table',Resources:tables})]).Data;
  assert.equal(permissions.TotalCount,4);
  assert.deepEqual(permissions.PermissionList.map(p=>p.Resource).sort(),tables.slice().sort());
  assert.ok(permissions.PermissionList.every(p=>p.Permission==='ADMINONLY'));
  const probes=[];
  for(const action of ['getTaxProfileStatus','submitTaxProfile']) {
    const result=cli(['api','scf','Invoke','--api-version','2018-04-16','--body',JSON.stringify({FunctionName:'payment-api',Namespace:envId,ClientContext:JSON.stringify({action}),LogType:'None'})]);
    const value=JSON.parse(result.Result.RetMsg);
    assert.equal(value.ok,false); assert.equal(value.error.code,'AUTH_CONTEXT_MISSING');
    probes.push({action,anonymousRejected:true});
  }
  const report={checkedAt:new Date().toISOString(),active:true,runtime:current.Runtime,configurationUnchanged:true,
    moneyAndTaxCollectionClosed:true,privateTaxKeyAbsent:true,tablesAdminOnly:true,probes,
    scope:'Live deployment metadata and anonymous rejection only; authenticated tax submission and real payments remain unverified.'};
  fs.writeFileSync(path.join(root,'.artifacts/tax-live-deployment-audit-2026-09-27.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch { console.error('TAX_DEPLOYMENT_AUDIT_FAILED'); process.exitCode=1; }
