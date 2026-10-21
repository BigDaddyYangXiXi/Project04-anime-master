const fs=require('node:fs'),path=require('node:path');
const sdk='../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection=require(sdk+'Connection').default,MiniProgram=require(sdk+'MiniProgram').default;
const pending=path.resolve(__dirname,'../.artifacts/auth-node20-runtime-pending.json');
const output=path.resolve(__dirname,'../.artifacts/auth-node20-wechat-runtime.json');
async function run(){
 const connection=await Connection.create('ws://127.0.0.1:9423'),mini=new MiniProgram(connection);
 const timer=setTimeout(()=>{console.error('OBSERVATION_TIMEOUT_PENDING_RETAINED');connection.dispose();process.exit(1);},25000);
 try{
  let job;
  if(fs.existsSync(pending))job=JSON.parse(fs.readFileSync(pending));
  else{
   job={key:'__authNode20_'+Date.now(),appid:'wxc94e1c1b38944511',env:'cloudbase-d2g65rqbvee0bd978'};
   fs.writeFileSync(pending,JSON.stringify(job),{flag:'wx'});
   await mini.evaluate(target=>{
    const state={done:false,stage:'client_identity'};getApp()[target.key]=state;
    (async()=>{try{
     const appid=wx.getAccountInfoSync().miniProgram.appId;
     if(appid&&appid!==target.appid)throw Error('APP_ID_MISMATCH');
     state.stage='cloud_init';
     wx.cloud.init({env:target.env,traceUser:true});
     state.stage='cloud_call';
     const response=await wx.cloud.callFunction({name:'auth-probe-node20',data:{}}),r=response.result;
     state.result={ok:r?.ok===true&&r.data?.authenticated===true&&r.data?.appId===target.appid,
      requestId:response.requestID||null,code:r?.error?.code||null};
    }catch(error){const message=String(error?.errMsg||error?.message||'');state.result={ok:false,code:'REAL_WECHAT_PROBE_FAILED',stage:state.stage,
     errorCode:typeof error?.errCode==='number'?error.errCode:null,
     reason:/appid missing/i.test(message)?'APPID_MISSING':/login|登录/i.test(message)?'LOGIN_REQUIRED':/permission|权限/i.test(message)?'PERMISSION':/timeout|超时/i.test(message)?'TIMEOUT':/not.*found|不存在/i.test(message)?'NOT_FOUND':'UNKNOWN'};}state.done=true;})();
    return true;
   },job);
  }
  for(let i=0;i<40;i++){
   const state=await mini.evaluate(key=>getApp()[key]||null,job.key);
   if(!state)throw Error('PENDING_JOB_MISSING');
   if(state.done){const result={checkedAt:new Date().toISOString(),...state.result,writesPerformed:false};fs.writeFileSync(output,JSON.stringify(result,null,2));fs.unlinkSync(pending);console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;return;}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw Error('PENDING_JOB_STILL_RUNNING');
 }finally{clearTimeout(timer);mini.disconnect();}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
