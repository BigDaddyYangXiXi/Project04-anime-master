// Simulator-only UI fixtures. Never creates orders, refunds or channel transactions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Connection=require('../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/Connection').default;
const MiniProgram=require('../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/MiniProgram').default;
async function main(){
 assert.equal(require('../miniprogram/config/cloudbase').enabled,false);
 const folder=path.resolve(__dirname,'../.artifacts/funds-refund-runtime-current');fs.mkdirSync(folder,{recursive:true});
 const mini=new MiniProgram(await Connection.create('ws://127.0.0.1:9422'));
 let phase='verify local preview';
 try{
  const state=await mini.evaluate(()=>({local:require('utils/local-preview.js').isLocal(),cloudEnabled:require('config/cloudbase.js').enabled}));
  assert.equal(state.local,true);assert.equal(state.cloudEnabled,false);
  const origin=await mini.currentPage();
  phase='navigate to funds';const page=await mini.navigateTo('/pages/funds/index?audit=1');
  phase='render partial refund';
  const base={id:'a'.repeat(32),orderId:'界面验收订单',status:'PAID',amountFen:10000,totalFen:10000,platformFeeFen:2000,
   expectedIncomeFen:5599,refundedFen:3001,retainedPlatformFeeFen:1400,paidAt:Date.now(),currency:'CNY'};
  const response={records:[base],nextCursor:null,merchantStatus:'NOT_STARTED'};
  await page.callMethod('renderResponse',response,false);
  await page.setData({loaded:true,loading:false});
  assert.equal((await page.data('records'))[0].refundText,'￥30.01');
  if(!process.argv.includes('--full-only')){
   phase='capture partial refund';await mini.screenshot({path:path.join(folder,'partial-refund.png')});
  }
  phase='render full refund';await page.callMethod('renderResponse',{...response,records:[{...base,refundedFen:10000,retainedPlatformFeeFen:0,expectedIncomeFen:0}]},false);
  assert.equal((await page.data('records'))[0].incomeStateText,'已全额退款');
  phase='capture full refund';await mini.screenshot({path:path.join(folder,'full-refund.png')});
  phase='return to origin';const back=await mini.navigateBack();assert.equal(back.path,origin.path);
  const report={checkedAt:new Date().toISOString(),fixtureOnly:true,cloudWrites:false,screenshots:process.argv.includes('--full-only')?['full-refund.png']:['partial-refund.png','full-refund.png'],
   returnedTo:back.path,limitations:['No real account or financial transaction','No multi-size acceptance','Screenshots require visual review']};
  fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){fs.writeFileSync(path.join(folder,'failure.json'),JSON.stringify({checkedAt:new Date().toISOString(),phase,error:error.message,runtimeAccepted:false,cloudWrites:false},null,2));throw error;}
 finally{mini.disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
