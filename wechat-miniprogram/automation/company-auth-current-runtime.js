// Read-only current simulator check. Never registers accounts or changes preview mode.
const fs=require('node:fs'),path=require('node:path');
const Connection=require('miniprogram-automator/out/Connection').default;
const MiniProgram=require('miniprogram-automator/out/MiniProgram').default;
let stage = 'CONNECT';
async function main(){
  const mini=new MiniProgram(await Connection.create(process.env.WECHAT_AUTO_WS||'ws://127.0.0.1:9423'));
  const folder=path.resolve(__dirname,'../.artifacts/company-auth-current-2026-09-27',String(Date.now()));
  fs.mkdirSync(folder,{recursive:true});
  try{
    stage = 'CURRENT_PAGE';
    const page=await mini.currentPage();
    stage = 'EVALUATE_AUTH';
    const result=await mini.evaluate(async()=>{
      const info=wx.getAccountInfoSync();
      const appId=info?.miniProgram?.appId||null;
      const result={appId,hasSession:Boolean(getApp().globalData.account),probe:'NOT_CALLED',
        runtimeVersion:getApp().globalData.version,
        localPreview:require('utils/local-preview.js').isLocal(),cloudEnabled:require('config/cloudbase.js').enabled};
      if(appId!=='wxc94e1c1b38944511'||result.localPreview||!result.cloudEnabled)return result;
      try{
        const response=await wx.cloud.callFunction({name:'auth-probe-node20',config:{env:'cloudbase-d2g65rqbvee0bd978'},data:{}});
        result.probe=response.result?.ok===true?'AUTHENTICATED':response.result?.error?.code||'REJECTED';
      }catch{result.probe='CALL_FAILED';}
      return result;
    });
    const report={checkedAt:new Date().toISOString(),page:page?.path,...result};
    fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
    stage = 'SCREENSHOT';
    await mini.screenshot({path:path.join(folder,'current.png')});
    console.log('CURRENT_SCREENSHOT_SAVED');
  }finally{mini.disconnect();}
}
main().catch(()=>{console.error(JSON.stringify({code:'CURRENT_RUNTIME_AUDIT_FAILED',stage}));process.exitCode=1;});
