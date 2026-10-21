// Invalid notifications only. Never signs a channel event or submits a refund.
const fs = require('node:fs');
const path = require('node:path');
const url = 'https://cloudbase-d2g65rqbvee0bd978-1494174688.ap-shanghai.app.tcloudbase.com/wechat-refund-notify';
async function main() {
  const checks=[];
  for (const test of [{name:'method',method:'GET',status:405},
    {name:'unsigned',method:'POST',body:'{}',status:403,error:'PAYMENT_SIGNATURE_INVALID'}]) {
    const response=await fetch(url,{method:test.method,body:test.body,headers:{'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});
    const body=await response.text();
    checks.push({name:test.name,status:response.status,error:response.headers.get('x-payment-error'),
      ok:response.status===test.status && (!test.error || response.headers.get('x-payment-error')===test.error)
        && !/1750932981|PRIVATE KEY|apiV3Key|mysql/i.test(body)});
  }
  const report={checkedAt:new Date().toISOString(),url,ok:checks.every(test=>test.ok),checks,
    scope:'Live HTTP method/signature rejection only; no signed refund, database persistence or arrival acceptance.'};
  fs.writeFileSync(path.join(__dirname,'../.artifacts/company-refund-http-audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(!report.ok)process.exitCode=1;
}
main().catch(()=>{console.error('REFUND_HTTP_AUDIT_FAILED');process.exitCode=1;});
