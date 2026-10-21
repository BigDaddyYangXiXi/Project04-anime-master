// Current simulator UI fixtures only. No cloud writes, draft submission or money operations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Connection=require('../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/Connection').default;
const MiniProgram=require('../.artifacts/devtools-audit-runtime/node_modules/miniprogram-automator/out/MiniProgram').default;
async function main() {
  assert.equal(require('../miniprogram/config/cloudbase').enabled,false);
  const mini=new MiniProgram(await Connection.create('ws://127.0.0.1:9422'));
  const folder=path.resolve(__dirname,'../.artifacts/refund-page-runtime-current');fs.mkdirSync(folder,{recursive:true});
  let phase='verify running preview';
  try {
    const running=await mini.evaluate(()=>({local:require('utils/local-preview.js').isLocal(),cloudEnabled:require('config/cloudbase.js').enabled}));
    assert.equal(running.local,true);assert.equal(running.cloudEnabled,false);
    phase='read system information';
    const system=await mini.callWxMethod('getSystemInfoSync');
    phase='open local orders';
    await mini.reLaunch('/pages/orders/index?audit=1');
    console.log('local order audit page opened');
    phase='open refund page';
    const page=await mini.navigateTo('/pages/order-refund/index?id=local_refund_audit');
    await page.waitFor(400);
    const order={id:'order_refund_audit',service:'摄影服务退款申请',amountFen:10000,paymentId:'a'.repeat(32),paymentStatus:'PAID',viewerRole:'BUYER',cloudOrder:true};
    await page.setData({order,canApply:true,totalText:'100.00',ready:true,historyReady:true,busy:false,error:'',historyError:'',draftState:'',
      amount:'',reason:'',records:[],nextCursor:null});
    await page.callMethod('submit');
    assert.match(await page.data('error'),/有效金额/);assert.equal(await page.data('busy'),false);
    await page.callMethod('inputAmount',{detail:{value:'30.00'}});
    await page.callMethod('inputReason',{detail:{value:'因服务时间调整，申请退回部分费用'}});
    assert.equal(await page.data('amount'),'30.00');assert.equal(await page.data('reason'),'因服务时间调整，申请退回部分费用');
    phase='capture application';
    await mini.screenshot({path:path.join(folder,'application.png')});
    console.log('application state captured');
    phase='verify unknown submission';
    await page.setData({draftState:'UNKNOWN',error:'申请结果尚未确认。请核对原申请，勿另建重复申请。'});
    await page.callMethod('inputAmount',{detail:{value:'50.00'}});await page.callMethod('inputReason',{detail:{value:'changed'}});
    assert.equal(await page.data('amount'),'30.00');assert.equal(await page.data('reason'),'因服务时间调整，申请退回部分费用');
    assert.equal(await (await page.$('button.am-action-primary')).text(),'核对原申请');
    await mini.screenshot({path:path.join(folder,'unknown.png')});
    console.log('unknown state captured');
    phase='verify acknowledged submission';
    await page.setData({draftState:'ACKNOWLEDGED',error:'',records:[{refundId:'b'.repeat(32),amountText:'30.00',statusText:'待审核'}]});
    const buttons=await page.$$('button');const labels=[];for(const button of buttons)labels.push(await button.text());
    assert.ok(labels.includes('申请另一笔退款'));assert.ok(!labels.includes('提交退款申请'));
    await mini.screenshot({path:path.join(folder,'acknowledged.png')});
    phase='verify provider records';
    await page.setData({order:{...order,viewerRole:'PROVIDER'},canApply:false,amount:'',reason:'',draftState:''});
    assert.equal(await page.$('input'),null);
    assert.equal(await page.$('textarea'),null);
    const providerButtons=await page.$$('button');const providerLabels=[];
    for(const button of providerButtons)providerLabels.push(await button.text());
    assert.ok(providerLabels.includes('刷新退款记录'));assert.ok(!providerLabels.includes('提交退款申请'));
    await mini.screenshot({path:path.join(folder,'provider-records.png')});
    phase='verify completed buyer';
    await page.setData({order:{...order,stage:'COMPLETED'},canApply:false});
    assert.equal(await page.$('input'),null);
    assert.equal(await page.$('textarea'),null);
    assert.ok(await page.$('button[open-type="feedback"]'));
    await mini.screenshot({path:path.join(folder,'completed-buyer.png')});
    phase='return to orders';
    const back=await mini.navigateBack();assert.equal(back.path,'pages/orders/index');
    const report={checkedAt:new Date().toISOString(),fixtureOnly:true,cloudWrites:false,realPayment:false,
      width:system.windowWidth,height:system.windowHeight,SDKVersion:system.SDKVersion,
      checks:['empty amount rejected','fields editable before submit','unknown fields locked','unknown original-request button','acknowledged next-request button','provider records without application inputs','back to orders'],
      screenshots:['application.png','unknown.png','acknowledged.png','provider-records.png','completed-buyer.png'],limitations:['one current simulator size','no native keyboard check','no real account or payment','native feedback submission not tested']};
    fs.writeFileSync(path.join(folder,'runtime.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }catch(error){
    fs.writeFileSync(path.join(folder,'failure.json'),JSON.stringify({checkedAt:new Date().toISOString(),phase,error:error.message,runtimeAccepted:false,cloudWrites:false},null,2));
    throw error;
  }finally{mini.disconnect();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
