// Native button attributes + real verified session navigation; no phone code or account mutation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sdk='../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection=require(sdk+'Connection').default,MiniProgram=require(sdk+'MiniProgram').default;
const out=path.resolve(__dirname,'../.artifacts/single-register-runtime');fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const mini=new MiniProgram(await Connection.create('ws://127.0.0.1:9423'));
 const report={checkedAt:new Date().toISOString(),ok:false,phoneAuthorizationInvoked:false,accountWrites:false};
 try{
  let page=await mini.reLaunch('/pages/auth/index');for(let i=0;i<150&&(await page.data()).checking;i++)await sleep(200);
  await page.callMethod('switchMode',{currentTarget:{dataset:{mode:'register'}}});
  assert.equal((await page.data()).acceptedNotice,false);
  await page.callMethod('updateNickname',{detail:{value:'注册页面检查'}});await page.callMethod('updateUsername',{detail:{value:'John.Smith'}});
  let button=await page.$('.primary-button');assert.equal(await button.attribute('open-type'),'');
  await page.callMethod('toggleNotice');assert.equal((await page.data()).canRegister,true);
  button=await page.$('.primary-button');assert.equal(await button.attribute('open-type'),'getRealtimePhoneNumber');assert.equal(await button.text(),'注册');
  assert.equal((await page.$$('.primary-button')).length,1);
  await mini.screenshot({path:path.join(out,'single-register.png')});report.directNativeButton=true;
  await page.callMethod('authorizeRegistrationPhone',{detail:{errMsg:'user deny'}});assert.equal((await page.data()).success,false);
  await mini.evaluate(()=>{getApp().__singleRegisterSession={done:false};wx.cloud.callFunction({name:'account-bootstrap',data:{action:'getSession'}}).then(({result})=>{getApp().__singleRegisterSession={done:true,result};});});
  let result;for(let i=0;i<150;i++){const value=await mini.evaluate(()=>getApp().__singleRegisterSession);if(value.done){result=value.result;break;}await sleep(200);}
  assert.equal(result?.ok,true);assert.equal(result.data.registered,true,'real registered account required for destination verification');
  await mini.callWxMethod('setStorageSync','animeMasterRole','provider');
  await mini.evaluate(()=>{getApp().globalData.pendingRoute='/pages/provider-home/index';});
  await page.callMethod('finish',result.data,'账号创建成功',true);await sleep(3500);
  page=await mini.currentPage();assert.equal(page.path,'pages/discover/index');assert.equal((await page.data()).role,'buyer');
  assert.equal(await mini.callWxMethod('getStorageSync','animeMasterRole'),'buyer');
  assert.equal(await mini.evaluate(()=>getApp().globalData.pendingRoute),'');
  for(let i=0;i<150&&(await page.data()).catalogLoading;i++)await sleep(200);
  await mini.screenshot({path:path.join(out,'registration-buyer-square.png')});report.buyerDestination=true;report.ok=true;
 }catch(e){report.error=e.message;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));mini.disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
