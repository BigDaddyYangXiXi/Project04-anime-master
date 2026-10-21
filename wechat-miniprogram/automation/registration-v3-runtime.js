// Real company read/precheck requests; never invokes phoneRegister or supplies a phone code.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const sdk='../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/';
const Connection=require(sdk+'Connection').default, MiniProgram=require(sdk+'MiniProgram').default;
const out=path.resolve(__dirname,'../.artifacts/registration-v3/runtime');fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
 const mini=new MiniProgram(await Connection.create('ws://127.0.0.1:9423'));
 const report={checkedAt:new Date().toISOString(),ok:false,phoneAuthorizationInvoked:false,checks:[]};
 async function request(action,extra={}){
  await mini.evaluate(({action,extra})=>{getApp().__registrationCheck={done:false};wx.cloud.callFunction({name:'account-bootstrap',data:{action,...extra}}).then(({result})=>{getApp().__registrationCheck={done:true,result};}).catch(()=>{getApp().__registrationCheck={done:true,result:{ok:false}};});},{action,extra});
  for(let i=0;i<150;i++){const value=await mini.evaluate(()=>getApp().__registrationCheck);if(value.done)return value.result;await sleep(200);}throw Error('CLOUD_CHECK_TIMEOUT');
 }
 try{
  assert.equal(await mini.evaluate(()=>wx.getAccountInfoSync().miniProgram.appId),'wxc94e1c1b38944511');
  const session=await request('getSession');assert.equal(session.ok,true);
  report.registered=session.data.registered;report.sessionIncludesCity=Object.hasOwn(session.data,'discoveryPreference');
  const rejected=await request('register');assert.equal(rejected.error?.code,'PHONE_AUTH_REQUIRED');report.checks.push('legacy-register-rejected');
  const invalid=await request('checkRegistration',{nickname:'合法昵称',username:'Invalid',acceptedNotice:true,noticeVersion:'account-use-v3'});assert.equal(invalid.error?.code,'INVALID_USERNAME');report.checks.push('server-username-validation');
  if(session.data.registered){
   await mini.evaluate(s=>getApp().setServerSession(s),session.data);
   await mini.callWxMethod('setStorageSync','animeMasterRole','provider');let page=await mini.reLaunch('/pages/discover/index');
   for(let i=0;i<150 && (await page.data()).dashboardLoading;i++)await sleep(200);
   const metrics=await mini.evaluate(()=>new Promise(resolve=>getCurrentPages().slice(-1)[0].createSelectorQuery().select('.avatar-large').fields({rect:true,size:true,computedStyle:['border-radius']}).select('.dashboard-title').fields({rect:true,size:true,computedStyle:['font-size']}).select('.dashboard-subtitle').fields({rect:true,size:true,computedStyle:['font-size']}).exec(resolve)));
   assert.ok(metrics[0]);assert.ok(Math.abs(metrics[0].width-metrics[0].height)<1);assert.equal(metrics[0]['border-radius'],'50%');assert.ok(parseFloat(metrics[1]['font-size'])>parseFloat(metrics[2]['font-size']));
   report.header=metrics;await mini.screenshot({path:path.join(out,'provider-workbench.png')});report.checks.push('round-avatar-and-type-hierarchy');
  }
  const page=await mini.reLaunch('/pages/auth/index');for(let i=0;i<150&&(await page.data()).checking;i++)await sleep(200);
  await page.callMethod('switchMode',{currentTarget:{dataset:{mode:'register'}}});
  await mini.screenshot({path:path.join(out,'registration-top.png')});
  await page.callMethod('submitRegister');assert.equal((await page.data()).fieldError,true);
  await page.callMethod('updateNickname',{detail:{value:'站长是虹口麻将皇帝'}});await page.callMethod('updateUsername',{detail:{value:'test_owner01'}});
  await page.callMethod('toggleNotice');await page.callMethod('submitRegister');
  for(let i=0;i<150&&(await page.data()).processing;i++)await sleep(200);
  const state=await page.data();assert.equal(state.phoneReady,true,state.errorMessage);assert.equal(state.success,false);
  const button=await page.$('button[open-type="getRealtimePhoneNumber"]');assert.ok(button);
  await mini.callWxMethod('pageScrollTo',{scrollTop:10000,duration:0});await sleep(250);await mini.screenshot({path:path.join(out,'registration-phone-step.png')});
  await page.callMethod('authorizeRegistrationPhone',{detail:{errMsg:'getRealtimePhoneNumber:fail user deny'}});assert.equal((await page.data()).success,false);report.checks.push('precheck-native-phone-button-and-cancel');
  await page.callMethod('showNotice');await sleep(3000);assert.equal((await mini.currentPage()).path,'pages/account-notice/index');await mini.navigateBack();await sleep(3000);assert.equal((await mini.currentPage()).path,'pages/auth/index');assert.equal((await (await mini.currentPage()).data()).username,'test_owner01');report.checks.push('agreement-return-retains-registration');
  report.ok=true;
 }catch(e){report.error=e.message;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));mini.disconnect();}
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
