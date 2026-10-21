const test = require("node:test");
const assert = require("node:assert/strict");
let definition;
global.Page = value => { definition = value; };
global.wx = { getStorageSync() {}, showModal() {}, showToast() {} };
require("../miniprogram/pages/fulfillment/index");
delete global.Page;
function page() {
  const p = { ...definition, cloudMode: true, orderId: "order-a", data: { ...structuredClone(definition.data),
    order: { id: "order-a", version: 3, stage: "DELIVERY_PENDING", finalPrice: 100 }, canAccept: true } };
  p.setData = patch => Object.assign(p.data, patch);
  return p;
}
test("取消验收不提交，重复点击只打开一次弹窗", t => {
  const p = page(); let modal; let prompts = 0; let transitions = 0;
  t.mock.method(wx, "showModal", options => { prompts++; modal = options; });
  p.runTransition = () => { transitions++; };
  p.accept(); p.accept();
  assert.equal(prompts, 1);
  modal.success({ confirm: false }); modal.complete();
  assert.equal(transitions, 0);
  p.accept(); assert.equal(prompts, 2);
});
test("弹窗期间订单、版本、阶段或可验收条件改变都阻止提交", t => {
  let modal; let toasts = 0;
  t.mock.method(wx, "showModal", options => { modal = options; });
  t.mock.method(wx, "showToast", () => { toasts++; });
  for (const change of [{ id: "order-b" }, { version: 4 }, { stage: "COMPLETED" }, null]) {
    const p = page(); p.runTransition = () => assert.fail("不能提交已过期确认");
    p.accept();
    if (change) p.data.order = { ...p.data.order, ...change }; else p.data.canAccept = false;
    modal.success({ confirm: true }); modal.complete();
  }
  assert.equal(toasts, 4);
});
test("同一交付确认正常提交，卸载后确认无效，请求中不再弹窗", t => {
  let modal; let prompts = 0; const events = [];
  t.mock.method(wx, "showModal", options => { prompts++; modal = options; });
  const p = page(); p.runTransition = event => events.push(event);
  p.accept(); modal.success({ confirm: true }); modal.complete();
  assert.deepEqual(events, ["BUYER_ACCEPTS_DELIVERY"]);
  p.data.actionPending = true; p.accept(); assert.equal(prompts, 1);
  p.data.actionPending = false; p.accept(); p.onUnload(); modal.success({ confirm: true }); modal.complete();
  assert.equal(events.length, 1);
});
