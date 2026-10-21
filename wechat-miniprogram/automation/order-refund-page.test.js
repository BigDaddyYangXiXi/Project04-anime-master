const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(options={}) {
  let page, account='buyer', draft=null, revision=1;
  const calls=[];
  const order={id:'order_1',viewerRole:'BUYER',cloudOrder:true,paymentStatus:'PAID',paymentId:'a'.repeat(32),amountFen:10000,...options.order};
  const services={
    '../../services/cloud-orders':{getOrder:options.getOrder || (async()=>order)},
    '../../services/cloud-refunds':{listRefunds:options.list || (async()=>({records:[],nextCursor:null}))},
    '../../data/refund-draft':{read:()=>draft,save:value=>{draft={...value,state:'DRAFT'};calls.push(value);},
      submit:async()=>{calls.push('submit');draft={...draft,state:'UNKNOWN'};if(options.submit)return options.submit();draft.state='ACKNOWLEDGED';},startNext:()=>{draft=null;}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/order-refund/index'),'utf8'),{
    Page:value=>{page=value;},require:name=>services[name],getApp:()=>({globalData:{account:{id:account}},sessionRevision:revision}),
    wx:{getStorageSync:()=>options.storedRole || 'buyer'}
  });
  page.setData=update=>Object.assign(page.data,update);
  page.onLoad({id:'order_1'});
  return {page,calls,renewSession:()=>revision++,setAccount:value=>{account=value;}};
}
test('refund entry rejects unrelated roles and unpaid direct routes',async()=>{
  for(const order of [{viewerRole:'OTHER'},{paymentStatus:'UNPAID'}]){
    const f=fixture({order});await f.page.load();assert.equal(f.page.data.ready,false);await f.page.submit();assert.equal(f.calls.length,0);
  }
});

test('refund navigation starts in the current workspace and resolves to the verified order role',async()=>{
  for(const [storedRole,viewerRole,expected] of [['provider','BUYER','buyer'],['buyer','PROVIDER','provider']]){
    const f=fixture({storedRole,order:{viewerRole}});
    assert.equal(f.page.data.navWorkspace,storedRole);
    await f.page.load();assert.equal(f.page.data.navWorkspace,expected);
  }
});

test('same-order refresh preserves unsent refund inputs, including a failed refresh and retry',async()=>{
  let fail=false;
  const order={id:'order_1',version:2,stage:'IN_PRODUCTION',viewerRole:'BUYER',cloudOrder:true,paymentStatus:'PAID',paymentId:'a'.repeat(32),amountFen:10000};
  const f=fixture({getOrder:async()=>{if(fail)throw Error('offline');return {...order};}});
  await f.page.load();f.page.inputAmount({detail:{value:'12.30'}});f.page.inputReason({detail:{value:'尚未提交的协商原因'}});
  await f.page.load();assert.equal(f.page.data.amount,'12.30');assert.equal(f.page.data.reason,'尚未提交的协商原因');
  fail=true;await f.page.load();assert.equal(f.page.data.ready,true);assert.ok(f.page.data.loadError);
  assert.equal(f.page.data.amount,'12.30');fail=false;await f.page.load();assert.equal(f.page.data.amount,'12.30');assert.equal(f.page.data.loadError,'');
  order.stage='COMPLETED';order.version=3;await f.page.load();assert.equal(f.page.data.canApply,false);assert.equal(f.page.data.amount,'');
});
test('provider can read records but cannot create or recover buyer applications',async()=>{
  const f=fixture({order:{viewerRole:'PROVIDER'},list:async()=>({records:[{refundId:'b'.repeat(32),amountFen:3000,status:'PROCESSING'}],nextCursor:null})});
  await f.page.load();assert.equal(f.page.data.ready,true);assert.equal(f.page.data.canApply,false);
  assert.equal(f.page.data.navWorkspace,'provider');
  assert.equal(f.page.data.records[0].amountText,'30.00');assert.equal(f.page.data.records[0].statusText,'退款处理中');
  for(const state of ['', 'UNKNOWN', 'ACKNOWLEDGED']) {
    f.page.data.draftState=state;f.page.data.amount='30';f.page.data.reason='退款';
    await f.page.submit();f.page.startNext();
  }
  assert.equal(f.calls.length,0);
});
test('completed buyer orders retain history but cannot submit or start another refund',async()=>{
  const f=fixture({order:{stage:'COMPLETED'}}); await f.page.load();
  assert.equal(f.page.data.ready,true); assert.equal(f.page.data.canApply,false);
  f.page.data.amount='10'; f.page.data.reason='反悔'; await f.page.submit();
  f.page.data.draftState='ACKNOWLEDGED'; f.page.startNext();
  assert.equal(f.calls.length,0); assert.equal(f.page.data.historyReady,true);
});
test('invalid money and oversized UTF8 reason never submit; exact cents are preserved',async()=>{
  const f=fixture();await f.page.load();f.page.data.reason='协商退款';
  for(const amount of ['0','-1','1.001','1e2','100.01']){f.page.data.amount=amount;await f.page.submit();}
  assert.equal(f.calls.length,0);
  f.page.data.amount='0.29';f.page.data.reason='退'.repeat(27);await f.page.submit();assert.equal(f.calls.length,0);
  f.page.data.reason='协商退款';await f.page.submit();assert.equal(f.calls[0].amountFen,29);assert.equal(f.page.data.draftState,'ACKNOWLEDGED');
});
test('double click cannot submit twice; unknown response locks fields and retains original application',async()=>{
  let reject;const f=fixture({submit:()=>new Promise((_,fail)=>{reject=fail;})});await f.page.load();
  f.page.data.amount='10';f.page.data.reason='协商退款';const first=f.page.submit();await f.page.submit();
  assert.equal(f.calls.filter(value=>value==='submit').length,1);reject(Error('timeout'));await first;
  assert.equal(f.page.data.draftState,'UNKNOWN');f.page.inputAmount({detail:{value:'20'}});assert.equal(f.page.data.amount,'10.00');
});
test('history failure is distinct from empty; changing account clears private page state',async()=>{
  const f=fixture({list:async()=>{throw Error('offline');}});await f.page.load();assert.equal(f.page.data.historyReady,false);assert.ok(f.page.data.historyError);
  f.setAccount('other');f.page.onShow();assert.equal(f.page.data.order,null);assert.equal(f.page.data.ready,false);assert.equal(f.page.data.reason,'');
});

test('provider order refund entry navigates only for paid provider cloud orders',()=>{
  let page;const navigations=[];
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/provider-request/index'),'utf8'),{
    Page:value=>{page=value;},require:()=>({}),wx:{navigateTo:value=>navigations.push(value.url)}
  });
  page.orderId='order_1';
  for(const order of [null,{cloudOrder:false,viewerRole:'PROVIDER',paymentStatus:'PAID'},
    {cloudOrder:true,viewerRole:'BUYER',paymentStatus:'PAID'},{cloudOrder:true,viewerRole:'PROVIDER',paymentStatus:'UNPAID'}]) {
    page.data.order=order;page.goRefund();
  }
  assert.equal(navigations.length,0);
  page.data.order={cloudOrder:true,viewerRole:'PROVIDER',paymentStatus:'PAID'};page.goRefund();
  assert.deepEqual(navigations,['/pages/order-refund/index?id=order_1']);
});

test('server completed-order rejection refreshes facts and removes ordinary refund eligibility',async()=>{
 let reads=0;
 const order={id:'order_1',version:2,stage:'IN_PRODUCTION',viewerRole:'BUYER',cloudOrder:true,paymentStatus:'PAID',paymentId:'a'.repeat(32),amountFen:10000};
 const f=fixture({getOrder:async()=>{reads++;return {...order,stage:reads===1?'IN_PRODUCTION':'COMPLETED',version:reads};},submit:async()=>{throw Object.assign(Error('completed'),{code:'REFUND_ORDER_COMPLETED'});}});
 await f.page.load();f.page.data.amount='10';f.page.data.reason='协商退款';await f.page.submit();
 assert.equal(reads,2);assert.equal(f.page.data.order.stage,'COMPLETED');assert.equal(f.page.data.canApply,false);assert.equal(f.page.data.busy,false);
 assert.match(f.page.data.error,/已验收完成/);
});

test('completed-order rejection stays non-applicable when the follow-up read fails',async()=>{
 let reads=0;
 const f=fixture({getOrder:async()=>{if(++reads>1)throw Error('offline');return {id:'order_1',stage:'IN_PRODUCTION',viewerRole:'BUYER',cloudOrder:true,paymentStatus:'PAID',paymentId:'a'.repeat(32),amountFen:10000};},submit:async()=>{throw Object.assign(Error('completed'),{code:'REFUND_ORDER_COMPLETED'});}});
 await f.page.load();f.page.data.amount='10';f.page.data.reason='协商退款';await f.page.submit();
 assert.equal(f.page.data.canApply,false);assert.equal(f.page.data.busy,false);assert.ok(f.page.data.loadError);
 const sent=f.calls.length;await f.page.submit();assert.equal(f.calls.length,sent);
});


test('renewed same-account session discards old refund-page submission result',async()=>{
 let finish;const f=fixture({submit:()=>new Promise(resolve=>{finish=resolve;})});
 await f.page.load();f.page.data.amount='10';f.page.data.reason='协商退款';const pending=f.page.submit();
 f.renewSession();f.page.setData=()=>assert.fail('stale session paint');finish({});await pending;
 assert.equal(f.page.current(),false);
});
