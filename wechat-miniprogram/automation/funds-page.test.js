const { test } = require("node:test");
const assert = require("node:assert/strict");
let definition;
global.Page = (value) => { definition = value; };
global.wx = { getStorageSync(key) { if (key === "animeMasterRole") return "provider"; throw new Error("funds must not read demo storage"); }, navigateTo() {}, stopPullDownRefresh() {} };
const { formatCents } = require("../miniprogram/pages/funds/index");
delete global.Page;
const cloudOrders = require("../miniprogram/services/cloud-orders");
const taxProfile = require('../miniprogram/services/cloud-tax-profile');
function response(patch = {}) {
  return { records: [{ id: "payment1", orderId: "order1", status: "PAID", amountFen: 10000, totalFen: 10000, platformFeeFen: 2000, expectedIncomeFen: 8000, paidAt: 1788600000000, currency: "CNY" }],
    nextCursor: null, merchantStatus: "NOT_STARTED", settlementStatus: "UNAVAILABLE", withdrawableBalanceFen: null, ...patch };
}
function page() {
  const instance = { data: structuredClone(definition.data) };
  for (const [key, value] of Object.entries(definition)) if (typeof value === "function") instance[key] = value.bind(instance);
  instance.setData = (patch) => Object.assign(instance.data, patch);
  return instance;
}
test('tax status loads independently and an old response cannot return after leaving', async (t) => {
  let resolveTax;
  t.mock.method(cloudOrders,'getProviderFunds',async()=>response());
  t.mock.method(taxProfile,'getStatus',()=>new Promise(resolve=>{resolveTax=resolve;}));
  const p=page(); const showing=p.onShow();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.data.loaded,true); assert.equal(p.data.taxCopy,'');
  p.onHide(); resolveTax({status:'VERIFIED'}); await showing;
  assert.equal(p.data.taxCopy,'');
});
test('tax failure preserves funds, retry shows review state without claiming withdrawability', async (t) => {
  t.mock.method(cloudOrders,'getProviderFunds',async()=>response());
  t.mock.method(taxProfile,'getStatus',async()=>{throw Error('offline');});
  const p=page(); await p.onShow();
  assert.equal(p.data.records.length,1); assert.equal(p.data.taxError,true);
  t.mock.method(taxProfile,'getStatus',async()=>({status:'VERIFIED'}));
  await p.loadTaxStatus();
  assert.equal(p.data.taxError,false); assert.match(p.data.taxCopy,/仍需核验/);
  assert.doesNotMatch(p.data.taxCopy,/可提现/);
  t.mock.method(taxProfile,'getStatus',async()=>{throw {code:'TAX_STATUS_NOT_CONFIGURED'};});
  await p.loadTaxStatus(); assert.equal(p.data.taxCopy,''); assert.equal(p.data.taxError,false);
});
test("funds page reads cloud receipts and opens the existing provider order route", async (t) => {
  t.mock.method(cloudOrders, "getProviderFunds", async () => response());
  const navigation = t.mock.method(wx, "navigateTo");
  const p = page(); await p.onShow();
  assert.equal(p.data.records[0].amountText, "￥100.00");
  assert.equal(p.data.records[0].incomeText, '￥80.00');
  assert.equal(p.data.records[0].feeText, '￥20.00');
  assert.equal(p.data.loaded, true);
  assert.match(p.data.merchantCopy, /尚未开通/);
  assert.match(p.data.settlementCopy, /不代表已结算/);
  p.openOrder({ currentTarget: { dataset: { id: "payment1" } } });
  assert.equal(navigation.mock.calls[0].arguments[0].url, "/pages/provider-request/index?id=order1");
});
test("cloud failure stays a visible error, then retry renders a genuine empty response", async (t) => {
  let failed = true;
  t.mock.method(cloudOrders, "getProviderFunds", async () => { if (failed) throw { code: "ORDER_API_FAILED" }; return response({ records: [] }); });
  const p = page(); await p.onShow();
  assert.equal(p.data.loaded, false); assert.match(p.data.loadError, /无法读取/);
  failed = false; await p.load();
  assert.equal(p.data.loaded, true); assert.equal(p.data.loadError, ""); assert.deepEqual(p.data.records, []);
  assert.equal(formatCents(null), "—"); assert.equal(formatCents(-1), "—"); assert.equal(formatCents(0), "0.00");
  assert.equal(formatCents(Number.MAX_SAFE_INTEGER), "90071992547409.91");
});

test('income rows explain partial refunds and never label a fully refunded payment as pending settlement', () => {
  const p=page(),base=response().records[0];
  p.renderResponse(response({records:[
    {...base,id:'partial',amountFen:10000,refundedFen:3001,retainedPlatformFeeFen:1400,expectedIncomeFen:5599},
    {...base,id:'full',amountFen:10000,refundedFen:10000,retainedPlatformFeeFen:0,expectedIncomeFen:0},
    {...base,id:'review',status:'PAID_REQUIRES_REVIEW',expectedIncomeFen:null}
  ]}),false);
  const [partial,full,review]=p.data.records;
  assert.equal(partial.hasRefund,true);assert.equal(partial.refundText,'￥30.01');assert.equal(partial.retainedFeeText,'￥14.00');
  assert.equal(partial.incomeText,'￥55.99');assert.equal(partial.incomeStateText,'待结算');
  assert.equal(full.incomeText,'￥0.00');assert.equal(full.incomeStateText,'已全额退款');
  assert.equal(review.hasRefund,false);assert.equal(review.incomeText,'待核对');assert.equal(review.incomeStateText,'待核对');
});
test('review receipt amount does not replace the order total or imply confirmed income', () => {
  const p = page();
  p.renderResponse(response({ records: [{ ...response().records[0], status: 'PAID_REQUIRES_REVIEW', totalFen: 9000, expectedIncomeFen: null }] }), false);
  assert.equal(p.data.records[0].amountText, '￥100.00');
  assert.equal(p.data.records[0].feeText, '￥20.00');
  assert.equal(p.data.records[0].incomeText, '待核对');
  assert.equal(p.data.records[0].statusText, '付款待核对');
});

test("pagination retry keeps records and prevents duplicate in-flight requests", async (t) => {
  const cursor = { id: "cursor", paidAt: 1000 };
  let release;
  t.mock.method(cloudOrders, "getProviderFunds", (value) => value ? new Promise((resolve, reject) => { release = reject; }) : Promise.resolve(response({ nextCursor: cursor })));
  const p = page(); await p.load();
  const pending = p.loadMore(); await p.loadMore();
  release(new Error("offline")); await pending;
  assert.equal(p.data.records.length, 1); assert.deepEqual(p.data.nextCursor, cursor); assert.match(p.data.moreError, /仍保留/);
  t.mock.method(cloudOrders, "getProviderFunds", async () => response({ records: [response().records[0], { ...response().records[0], id: "payment2", status: "PAID_REQUIRES_REVIEW" }] }));
  await p.loadMore(); assert.equal(p.data.records.length, 2); assert.equal(p.data.records[1].statusText, "付款待核对");
});
test("refresh wins over an older pending pagination response", async (t) => {
  let release;
  t.mock.method(cloudOrders, "getProviderFunds", (cursor) => cursor ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(response({ nextCursor: { id: "cursor", paidAt: 1000 } })));
  const p = page(); await p.load(); const old = p.loadMore();
  t.mock.method(cloudOrders, "getProviderFunds", async () => response({ records: [] }));
  await p.load(); release(response()); await old;
  assert.deepEqual(p.data.records, []); assert.equal(p.data.loadingMore, false);
});

test('funds first page and pagination discard late results after leaving',async t=>{
 for(const method of ['load','loadMore'])for(const failed of [false,true]){
  const p=page();p.data.nextCursor='next';p.request=1;let resolve,reject,writes=0;
  t.mock.method(cloudOrders,'getProviderFunds',()=>new Promise((a,b)=>{resolve=a;reject=b;}));
  const task=p[method]();p.onHide();p.setData=()=>{writes++;};if(failed)reject(Error('late'));else resolve(response());await task;assert.equal(writes,0);
 }
});

test('hidden funds page starts no requests and returning restores fresh data',async t=>{
 const p=page();let calls=0;t.mock.method(cloudOrders,'getProviderFunds',async()=>{calls++;return response();});t.mock.method(taxProfile,'getStatus',async()=>({status:'PENDING'}));p.onHide();await p.load();await p.loadMore();assert.equal(calls,0);await p.onShow();assert.equal(calls,1);assert.equal(p.data.loaded,true);assert.equal(p.data.records.length,1);assert.equal(p.data.loading,false);
});

 test('buyer funds reuses the page, reads only buyer order amounts and opens original order routes', async t => {
  global.getApp = () => ({globalData:{account:{id:'buyer'}}});
  t.mock.method(wx, 'getStorageSync', () => 'buyer');
  t.mock.method(cloudOrders, 'getProviderFunds', () => assert.fail('buyer must not read provider funds'));
  t.mock.method(taxProfile, 'getStatus', () => assert.fail('buyer must not read provider tax'));
  t.mock.method(cloudOrders, 'listOrders', async () => [
   {id:'paid', viewerRole:'BUYER', paymentStatus:'PAID', stage:'COMPLETED', amountFen:12345},
   {id:'pending', viewerRole:'BUYER', stage:'BUYER_FINAL_CONFIRM', amountFen:500},
   {id:'other', viewerRole:'PROVIDER', paymentStatus:'PAID', amountFen:9900},
   {id:'draft', viewerRole:'BUYER', stage:'REQUESTED'}
  ]);
  const urls=[]; t.mock.method(wx, 'navigateTo', value=>urls.push(value.url));
  const p=page(); await p.onShow(); assert.equal(p.data.role,'buyer'); assert.deepEqual(p.data.records.map(x=>x.id),['paid','pending']); assert.equal(p.data.records[0].amountText,'￥123.45');
  for(const id of ['paid','pending'])p.openOrder({currentTarget:{dataset:{id}}});
  assert.deepEqual(urls,['/pages/order-detail/index?id=paid','/pages/booking-status/index?id=pending']);
 });
 test('buyer funds discards results on exit or account replacement', async t=>{
  let owner='one',finish;global.getApp=()=>({globalData:{account:{id:owner}}});
  t.mock.method(cloudOrders,'listOrders',()=>new Promise(resolve=>finish=resolve));
  for(const reason of ['leave','account']) {owner='one';const p=page();p.data.role='buyer';const pending=p.load();if(reason==='leave')p.onHide();else owner='two';finish([{id:'stale',viewerRole:'BUYER',paymentStatus:'PAID',amountFen:100}]);await pending;assert.deepEqual(p.data.records,[]);}
 });
