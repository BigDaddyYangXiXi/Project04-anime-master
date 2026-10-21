const test = require("node:test");
const assert = require("node:assert/strict");
const cloudOrders = require("../miniprogram/services/cloud-orders");
const definitions = {};
for (const route of ["booking-status", "order-detail", "provider-request", "fulfillment", "provider-task"]) {
  global.Page = definition => { definitions[route] = definition; };
  require(`../miniprogram/pages/${route}/index`);
}
delete global.Page;
function create(route) {
  const definition = definitions[route];
  const page = { ...definition, cloudMode: true, orderId: "order-1", data: structuredClone(definition.data) };
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.read = () => route === "booking-status" ? page.loadOrder() : page.load();
  return page;
}
function order(version, paymentStatus) {
  return { id: "order-1", cloudOrder: true, version, stage: "BUYER_FINAL_CONFIRM", paymentStatus };
}
function pending() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
test("服务方协议确认拒绝过期版本，已发送签署离页后不回写", async t => {
  for (const failed of [false, true]) {
    const page = create("provider-task"), response = pending();
    page.data.order = order(3, "UNPAID");
    page.data.canSign = true;
    let modal, calls = 0;
    global.wx = { showModal: value => { modal = value; }, showToast() {} };
    t.mock.method(cloudOrders, "transitionOrder", () => { calls++; return response.promise; });
    page.sign();
    page.data.order = order(4, "UNPAID");
    modal.success({ confirm: true });
    assert.equal(calls, 0);
    page.sign();
    modal.success({ confirm: true });
    assert.equal(calls, 1);
    page.onUnload();
    page.setData = () => assert.fail("离页后不得写入签署结果");
    page.load = () => assert.fail("离页后不得重读协议");
    if (failed) response.reject(Object.assign(Error("conflict"), { code: "VERSION_CONFLICT" }));
    else response.resolve(order(5, "UNPAID"));
    await new Promise(resolve => setImmediate(resolve));
  }
});
test("需求方签署及合作确认绑定弹窗时版本，取消和离页不提交", () => {
  for (const action of ["signNda", "confirmAgreement"]) {
    for (const state of ["current", "updated", "unloaded", "cancel"]) {
      const page = create("booking-status");
      page.data.order = order(3, "UNPAID");
      page.data.canSignNda = page.data.canConfirmAgreement = true;
      let modal, calls = 0;
      global.wx = { showModal: value => { modal = value; }, showToast() {} };
      page.runTransition = () => { calls++; };
      page[action]();
      assert.ok(modal, action);
      if (state === "updated") page.data.order = order(4, "UNPAID");
      if (state === "unloaded") page.onUnload();
      modal.success({ confirm: state !== "cancel" });
      assert.equal(calls, state === "current" ? 1 : 0);
    }
  }
});
test("验收页同版本返回保留修改意见，包括主动清空；新版本重新核对", async t => {
  const page = create("fulfillment");
  const source = { ...order(3, "PAID"), stage: "DELIVERY_PENDING", revisionNote: "上次意见" };
  page.renderOrder(source);
  t.mock.method(cloudOrders, "getOrder", async () => ({ ...source }));
  for (const revision of ["请调整第二张图片", ""]) {
    page.updateRevision({ detail: { value: revision } });
    await page.load();
    assert.equal(page.data.revision, revision);
    assert.equal(page.data.canRevise, Boolean(revision));
  }
  page.updateRevision({ detail: { value: "尚未提交" } });
  t.mock.method(cloudOrders, "getOrder", async () => ({ ...source, version: 4, revisionNote: "最新意见" }));
  await page.load();
  assert.equal(page.data.revision, "最新意见");
});

test("验收意见不得跨订单或阶段保留，提交成功使用服务端结果", async t => {
  const source = { ...order(3, "PAID"), stage: "DELIVERY_PENDING" };
  for (const patch of [{ id: "order-2" }, { stage: "COMPLETED" }]) {
    const page = create("fulfillment");
    page.renderOrder(source);
    page.updateRevision({ detail: { value: "旧草稿" } });
    t.mock.method(cloudOrders, "getOrder", async () => ({ ...source, ...patch, revisionNote: "服务端意见" }));
    await page.load();
    assert.equal(page.data.revision, "服务端意见");
  }
  const page = create("fulfillment");
  page.renderOrder(source);
  page.updateRevision({ detail: { value: "  请调整构图  " } });
  global.wx = { showToast() {} };
  t.mock.method(cloudOrders, "transitionOrder", async (id, version, event, fields) => {
    assert.equal(fields.detail, "请调整构图");
    return { ...source, version: 4, stage: "REVISION_REQUESTED", revisionNote: fields.detail };
  });
  await page.revise();
  assert.equal(page.data.revision, "请调整构图");
  assert.equal(page.data.order.stage, "REVISION_REQUESTED");
});
for(const route of ['booking-status','provider-request','fulfillment']){
  test(`${route}: 离页后的订单操作结果不更新页面、提示或触发刷新`,async t=>{
    for(const failed of [false,true]){
      const response=pending(),page=create(route);
      page.data.order=order(3,'PAID');
      global.wx={showToast:()=>assert.fail('卸载后不得提示')};
      t.mock.method(cloudOrders,'transitionOrder',()=>response.promise);
      const operation=page.runTransition('TEST_EVENT',{},()=>assert.fail('卸载后不得执行后续回调'));
      page.onUnload();
      page.setData=()=>assert.fail('卸载后不得写页面');
      page.renderOrder=()=>assert.fail('卸载后不得渲染');
      page.load=page.loadOrder=()=>assert.fail('卸载后不得重新读取');
      if(failed)response.reject(Object.assign(Error('late conflict'),{code:'VERSION_CONFLICT'}));
      else response.resolve(order(4,'PAID'));
      await operation;
      t.mock.method(cloudOrders,'transitionOrder',()=>assert.fail('卸载后不得发出新操作'));
      await page.runTransition('TEST_EVENT');
    }
  });
}
for (const route of Object.keys(definitions)) {
  test(`${route}: 较早的刷新成功或失败不得覆盖后到的已付款记录`, async t => {
    for (const failed of [false, true]) {
      const first = pending(), second = pending();
      let calls = 0;
      t.mock.method(cloudOrders, "getOrder", () => ++calls === 1 ? first.promise : second.promise);
      const page = create(route);
      const oldRead = page.read(), newRead = page.read();
      second.resolve(order(4, "PAID"));
      await newRead;
      if (failed) first.reject(new Error("old network error"));
      else first.resolve(order(3, "UNPAID"));
      await oldRead;
      assert.equal(page.data.order.paymentStatus, "PAID");
      assert.equal(page.data.order.version, 4);
      assert.equal(page.data.loadError, "");
      assert.equal(page.data.loading, false);
    }
  });
  test(`${route}: 付款结果已刷新后，旧读取不能回退状态或抹掉页面`, async t => {
    for (const failed of [false, true]) {
      const first = pending();
      t.mock.method(cloudOrders, "getOrder", () => first.promise);
      const page = create(route);
      const read = page.read();
      page.renderOrder(order(5, "PAYMENT_REVIEW"));
      if (failed) first.reject(new Error("offline"));
      else first.resolve(order(3, "UNPAID"));
      await read;
      assert.equal(page.data.order.paymentStatus, "PAYMENT_REVIEW");
      assert.equal(page.data.loadError, "");
      assert.equal(page.data.loading, false);
    }
  });
  test(`${route}: 卸载后不更新页面，当前请求失败仍保留重试画面`, async t => {
    const read = pending();
    t.mock.method(cloudOrders, "getOrder", () => read.promise);
    const page = create(route);
    const request = page.read();
    page.onUnload();
    page.setData = () => { assert.fail("unloaded page must not receive updates"); };
    read.resolve(order(4, "PAID"));
    await request;
    t.mock.method(cloudOrders, "getOrder", async () => { throw new Error("offline"); });
    const retryPage = create(route);
    await retryPage.read();
    assert.equal(retryPage.data.loading, false);
    assert.equal(retryPage.data.order, null);
    assert.notEqual(retryPage.data.loadError, "");
  });
}
test("下拉刷新在读取结束后停止动画", async t => {
  const read = pending();
  t.mock.method(cloudOrders, "getOrder", () => read.promise);
  let stopped = 0;
  global.wx = { stopPullDownRefresh: () => { stopped++; } };
  const page = create("booking-status");
  const refresh = page.onPullDownRefresh();
  assert.equal(stopped, 0);
  read.resolve(order(4, "PAID"));
  await refresh;
  assert.equal(stopped, 1);
});
