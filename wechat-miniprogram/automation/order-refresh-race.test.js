const test = require("node:test");
const assert = require("node:assert/strict");
const cloudOrders = require("../miniprogram/services/cloud-orders");
const definitions = {};
for (const route of ["booking-status", "order-detail", "provider-request"]) {
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
