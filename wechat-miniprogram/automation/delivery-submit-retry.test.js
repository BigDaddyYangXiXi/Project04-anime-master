const test = require("node:test");
const assert = require("node:assert/strict");
let definition;
global.Page = (value) => { definition = value; };
global.wx = { getStorageSync() { return ""; }, showToast() {} };
require("../miniprogram/pages/provider-request/index");
delete global.Page;
const orders = require("../miniprogram/services/cloud-orders");
const local = { name: "交付.pdf", path: "local.pdf", size: 100 };
const remote = { name: "交付.pdf", assetId: "asset_test", fileId: "cloud://test/file.pdf" };
function liveRenderPage() {
  const p = page();
  p.renderOrder = definition.renderOrder.bind(p);
  p.data.order = { id: "order-a", version: 3, stage: "IN_PRODUCTION", cloudOrder: true, career: "摄影" };
  return p;
}
function page() {
  const p = { orderId: "order-a", cloudMode: true, data: { ...structuredClone(definition.data), order: { id: "order-a", version: 3 }, delivery: "已完成交付", deliveryFiles: [local] } };
  for (const [name, fn] of Object.entries(definition)) if (typeof fn === "function") p[name] = fn.bind(p);
  p.setData = (patch, callback) => { Object.assign(p.data, patch); if (callback) callback(); };
  p.renderOrder = (order) => { p.data.order = order; };
  p.cloudErrorMessage = (error) => error.message;
  p.refreshDerived = () => {};
  return p;
}
test("订单提交失败后保留云文件，再次提交复用资产凭据", async (t) => {
  const p = page(); let attempts = 0; const inputs = [];
  t.mock.method(orders, "uploadDeliveryFiles", async (id, files) => { inputs.push(files); return [remote]; });
  t.mock.method(orders, "transitionOrder", async () => { if (++attempts === 1) throw new Error("网络中断"); return { id: "order-a", version: 4 }; });
  await p.submitCloudDelivery();
  assert.equal(p.data.actionPending, false);
  assert.deepEqual(p.data.deliveryFiles, [remote]);
  await p.submitCloudDelivery();
  assert.deepEqual(inputs, [[local], [remote]]);
  assert.equal(p.data.order.version, 4);
});
test("上传期间重复提交被拦截，说明和版本使用发起时快照", async (t) => {
  const p = page(); let resolveUpload; let uploads = 0; let submission;
  t.mock.method(orders, "uploadDeliveryFiles", () => { uploads++; return new Promise((resolve) => { resolveUpload = resolve; }); });
  t.mock.method(orders, "transitionOrder", async (...args) => { submission = args; return { id: "order-a", version: 4 }; });
  const pending = p.submitCloudDelivery();
  await p.submitCloudDelivery();
  p.updateDelivery({ detail: { value: "未确认的新说明" } });
  assert.equal(p.data.delivery, "已完成交付");
  p.data.order = { id: "order-a", version: 5 };
  p.data.delivery = "外部刷新后的说明";
  resolveUpload([remote]); await pending;
  assert.equal(uploads, 1);
  assert.equal(submission[1], 3);
  assert.equal(submission[3].deliveryNote, "已完成交付");
});
test("上传失败不调用订单提交且保留原文件供重试", async (t) => {
  const p = page(); let transitions = 0;
  t.mock.method(orders, "uploadDeliveryFiles", async () => { throw new Error("上传失败"); });
  t.mock.method(orders, "transitionOrder", async () => { transitions++; });
  await p.submitCloudDelivery();
  assert.equal(transitions, 0);
  assert.deepEqual(p.data.deliveryFiles, [local]);
  assert.equal(p.data.actionPending, false);
});

test("交付上传期间卸载页面，上传结束不再提交订单或提示", async (t) => {
  for (const failed of [false,true]) {
    const p=page(); let resolve,reject;
    t.mock.method(orders,"uploadDeliveryFiles",()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
    t.mock.method(orders,"transitionOrder",()=>assert.fail("离页后不得开始提交交付"));
    const pending=p.submitCloudDelivery();p.onUnload();
    p.setData=()=>assert.fail("离页后不得更新页面");
    t.mock.method(wx,"showToast",()=>assert.fail("离页后不得弹出提示"));
    if(failed)reject(Error("late upload failure"));else resolve([remote]);
    await pending;
  }
});

test("交付提交已发送后离页，成功与失败结果不写旧页面",async t=>{
  for(const failed of [false,true]){
    const p=page();p.data.onsite=true;let resolve,reject;
    t.mock.method(orders,'transitionOrder',()=>new Promise((yes,no)=>{resolve=yes;reject=no;}));
    const pending=p.submitCloudDelivery();p.onUnload();
    p.setData=()=>assert.fail('不能写旧页面');p.renderOrder=()=>assert.fail('不能渲染旧页面');
    t.mock.method(wx,'showToast',()=>assert.fail('不能弹出旧提示'));
    if(failed)reject(Error('late failure'));else resolve({id:'order-a',version:4});
    await pending;
  }
});

test("离页后的文件选择和交付确认回调不再启动操作",t=>{
  const p=page();let chooser,modal;
  wx.chooseMessageFile=options=>{chooser=options;};wx.showModal=options=>{modal=options;};
  try{
    p.data.deliveryReady=true;p.data.order.stage='IN_PRODUCTION';
    p.chooseDeliveryFiles();p.submitDelivery();p.onUnload();
    p.setData=()=>assert.fail('不能写旧页面');p.submitCloudDelivery=()=>assert.fail('不能重新提交');
    t.mock.method(wx,'showToast',()=>assert.fail('不能弹出旧提示'));
    chooser.success({tempFiles:[local]});chooser.fail({errMsg:'late failure'});modal.success({confirm:true});
  }finally{delete wx.chooseMessageFile;delete wx.showModal;}
});
test("文件选择取消与空结果保留已有文件，失败可见", (t) => {
  const p = page(); let options; const toasts = [];
  t.mock.method(wx, "showToast", (value) => toasts.push(value));
  wx.chooseMessageFile = (value) => { options = value; };
  try {
    p.chooseDeliveryFiles(); options.success({ tempFiles: [] });
    options.fail({ errMsg: "chooseMessageFile:fail cancel" });
    assert.equal(toasts.length, 0); assert.deepEqual(p.data.deliveryFiles, [local]);
    p.data.actionPending = true;
    options.success({ tempFiles: [{ name: "late.pdf", path: "late.pdf", size: 1 }] });
    assert.deepEqual(p.data.deliveryFiles, [local]);
    options.fail({ errMsg: "chooseMessageFile:fail unavailable" });
    assert.equal(toasts.length, 1);
  } finally { delete wx.chooseMessageFile; }
});
test("后台返回加载同版本订单保留交付说明和文件", async (t) => {
  const p = liveRenderPage(); const files = p.data.deliveryFiles;
  t.mock.method(orders, "getOrder", async () => ({ ...p.data.order, deliveryNote: "", deliveryFiles: [] }));
  await p.load();
  assert.equal(p.data.delivery, "已完成交付");
  assert.equal(p.data.deliveryFiles, files);
  assert.equal(p.data.loading, false);
});

test("预约补充说明同版本保留，进入沟通后不把隐藏旧输入当作失败原因", async t => {
  const p = liveRenderPage();
  const source = { ...p.data.order, stage: "REQUESTED" };
  p.renderOrder(source);
  p.updateNote({ detail: { value: "请补充参考图" } });
  t.mock.method(orders, "getOrder", async () => ({ ...source }));
  await p.load();
  assert.equal(p.data.note, "请补充参考图");
  t.mock.method(orders, "transitionOrder", async () => ({ ...source, version: 4, stage: "CONTACTING" }));
  await p.interested();
  assert.equal(p.data.note, "");
  let modal;
  wx.showModal = options => { modal = options; };
  try {
    p.failCommunication();
    assert.ok(!modal.content.includes("请补充参考图"));
    assert.ok(modal.content.includes("本次沟通未能确认合作条件"));
  } finally { delete wx.showModal; }
});

test("服务方五类确认弹窗拒绝订单更新后或离页后的确认", t => {
  const toasts = [];
  t.mock.method(wx, "showToast", value => toasts.push(value));
  for (const action of ["decline", "savePrice", "finishCommunication", "failCommunication", "submitDelivery"]) {
    for (const changed of ["version", "stage", "id", "unloaded", "unchanged"]) {
      const p = liveRenderPage();
      p.data.order.stage = action === "decline" ? "REQUESTED" : action === "submitDelivery" ? "IN_PRODUCTION" : "CONTACTING";
      p.data.priceCanSave = p.data.readyConfirm = p.data.deliveryReady = true;
      let modal;
      wx.showModal = options => { modal = options; };
      let submissions = 0;
      p.runTransition = p.submitCloudDelivery = () => { submissions++; };
      try {
        p[action]();
        assert.ok(modal);
        if (changed === "unloaded") p.onUnload();
        else if (changed !== "unchanged") p.data.order = { ...p.data.order, [changed]: changed === "version" ? 4 : changed === "stage" ? "COMPLETED" : "other" };
        const toastCount = toasts.length;
        modal.success({ confirm: true });
        assert.equal(submissions, changed === "unchanged" ? 1 : 0, action);
        assert.equal(toasts.length, toastCount + (["unloaded", "unchanged"].includes(changed) ? 0 : 1));
      } finally { delete wx.showModal; }
    }
  }
});

test("同版本返回保留未锁定报价和合作确认，新版本重新核对",()=>{
  const p=liveRenderPage();p.refreshDerived=definition.refreshDerived.bind(p);
  const source={...p.data.order,stage:'CONTACTING',ndaRequired:null,contactFirstCopiedAt:1,
    serviceItems:[{id:'service',name:'摄影服务',displayPrice:100,finalPrice:100}]};
  p.renderOrder(source);
  p.updateQuoteItem({currentTarget:{dataset:{index:0}},detail:{value:'110'}});
  p.toggleConfirm({currentTarget:{dataset:{key:'timePlaceConfirmed'}}});
  p.toggleConfirm({currentTarget:{dataset:{key:'serviceScopeConfirmed'}}});
  p.chooseNda({currentTarget:{dataset:{value:'yes'}}});
  p.renderOrder({...source},{preserveDeliveryDraft:true});
  assert.equal(p.data.price,110);assert.equal(p.data.quoteChanged,true);
  assert.equal(p.data.timePlaceConfirmed,true);assert.equal(p.data.serviceScopeConfirmed,true);assert.equal(p.data.ndaChoice,'yes');
  assert.equal(p.data.amountConfirmed,false);
  p.renderOrder({...source,version:4},{preserveDeliveryDraft:true});
  assert.equal(p.data.price,100);assert.equal(p.data.timePlaceConfirmed,false);assert.equal(p.data.ndaChoice,'');
});

test("执行页同版本返回保留未保存进度，提交结果使用服务端值",()=>{
  const p=liveRenderPage();p.refreshDerived=definition.refreshDerived.bind(p);
  const source={...p.data.order,progress:20};p.renderOrder(source);p.commitProgress({detail:{value:65}});
  p.renderOrder({...source},{preserveDeliveryDraft:true});assert.equal(p.data.progress,65);assert.equal(p.data.progressChanged,true);
  p.renderOrder({...source,version:4,progress:65});assert.equal(p.data.progress,65);assert.equal(p.data.progressChanged,false);
});
test("订单版本或阶段变化不保留旧交付草稿", () => {
  for (const patch of [{ version: 4 }, { stage: "DELIVERY_PENDING" }, { id: "order-b" }]) {
    const p = liveRenderPage();
    p.renderOrder({ ...p.data.order, ...patch, deliveryNote: "服务端交付", deliveryFiles: [remote] }, { preserveDeliveryDraft: true });
    assert.equal(p.data.delivery, "服务端交付");
    assert.deepEqual(p.data.deliveryFiles, [remote]);
  }
});
test("提交结果渲染不保留草稿，过期刷新不覆盖新版本", () => {
  const p = liveRenderPage();
  p.renderOrder({ ...p.data.order, version: 4, stage: "DELIVERY_PENDING", deliveryNote: "已提交", deliveryFiles: [remote] });
  const current = p.data.order;
  p.renderOrder({ ...current, version: 3, stage: "IN_PRODUCTION", deliveryNote: "旧内容" }, { preserveDeliveryDraft: true });
  assert.equal(p.data.order, current);
  assert.equal(p.data.delivery, "已提交");
  assert.deepEqual(p.data.deliveryFiles, [remote]);
});
