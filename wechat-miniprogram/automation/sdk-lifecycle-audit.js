// Isolated initialization only: sanitized environment, no credentials or network.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const roots={production:'cloudfunctions/order-api',candidate:'.artifacts/sdk4-compatibility'};
if(process.argv[2]==='--child') {
  const selected=roots[process.argv[3]];
  if(!selected)throw Error('INVALID_CANDIDATE');
  const deny=()=>{throw Error('LIFECYCLE_NETWORK_DENIED');};
  require('node:net').Socket.prototype.connect=deny;
  require('node:tls').connect=deny;
  for(const transport of [require('node:http'),require('node:https')])transport.request=transport.get=deny;
  globalThis.fetch=deny;
  const intervals=[],originalInterval=globalThis.setInterval;
  const messagePorts=[];
  const hook=require('node:async_hooks').createHook({init(_id,type){
    if(type==='MESSAGEPORT')messagePorts.push(new Error().stack.split('\n').slice(2,10).map(line=>line.replaceAll(root,'<project>')));
  }});
  hook.enable();
  globalThis.setInterval=function(callback,delay,...args){
    intervals.push({delay,source:new Error().stack.split('\n').slice(2,5).map(line=>line.replaceAll(root,'<project>'))});
    return originalInterval(callback,delay,...args);
  };
  const modules=path.join(root,selected,'node_modules');
  const sdk=require(path.join(modules,'@cloudbase/node-sdk'));
  const wechat=require(path.join(modules,'wx-server-sdk'));
  sdk.init({env:'local-lifecycle-fixture',timeout:250,retries:0});
  wechat.init({env:'local-lifecycle-fixture'});
  const portsAfterFirst=process.getActiveResourcesInfo().filter(type=>type==='MessagePort').length;
  for(let i=0;i<10;i++)sdk.init({env:'local-lifecycle-fixture',timeout:250,retries:0});
  const portsAfterRepeated=process.getActiveResourcesInfo().filter(type=>type==='MessagePort').length;
  console.log(JSON.stringify({initialized:true,node:process.version,
    sdk:require(path.join(modules,'@cloudbase/node-sdk/package.json')).version,
    portsAfterFirst,portsAfterRepeated,extraInitializations:10,
    resources:process.getActiveResourcesInfo(),intervals,messagePorts:messagePorts.slice(0,2),totalPortsCreated:messagePorts.length}));
  hook.disable();
  // No process.exit: the parent records natural completion or terminates at its deadline.
} else {
  const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const checks=Object.keys(roots).map(name=>{
    const started=Date.now();
    const run=spawnSync(process.execPath,[__filename,'--child',name],{cwd:root,env,encoding:'utf8',timeout:6000,windowsHide:true,maxBuffer:65536});
    let detail;try{detail=JSON.parse(run.stdout.trim().split(/\r?\n/).findLast(line=>line.startsWith('{"initialized":')));}catch{detail={initialized:false};}
    return {name,...detail,naturalExit:run.status===0&&!run.error,deadlineReached:run.error?.code==='ETIMEDOUT',elapsedMs:Date.now()-started};
  });
  const report={checkedAt:new Date().toISOString(),checks,networkAllowed:false,productionChanged:false,
    scope:'Local initialization lifecycle only; not cloud request completion or business acceptance.'};
  fs.writeFileSync(path.join(root,'.artifacts/sdk-lifecycle-audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(checks.some(c=>!c.initialized))process.exitCode=1;
}
