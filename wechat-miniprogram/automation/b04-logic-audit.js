const assert = require("assert");

const storage = new Map();
let pageDefinition = null;
let navigatedTo = "";
let switchedTo = "";
let modalConfirm = true;
let modalTitle = "";
let paymentMode = "success";
let paymentCalls = 0;

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateTo({ url }) { navigatedTo = url; },
  redirectTo({ url }) { navigatedTo = url; },
  reLaunch({ url }) { switchedTo = url; },
  switchTab({ url }) { switchedTo = url; },
  showToast() {},
  stopPullDownRefresh() {},
  showModal({ title, success }) { modalTitle = title; if (success) success({ confirm: modalConfirm }); },
  requestPayment({ success, fail }) {
    paymentCalls += 1;
    if (paymentMode === "success") success({ errMsg: "requestPayment:ok" });
    else fail({ errMsg: paymentMode === "cancel" ? "requestPayment:fail cancel" : "requestPayment:fail" });
  }
};
global.Page = (definition) => { pageDefinition = definition; };

const store = require("../miniprogram/data/v063-store");
const machine = require("../miniprogram/data/order-machine");
require("../miniprogram/pages/booking-status/index.js");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function seed(patch) {
  const order = Object.assign(clone(store.initialOrders[0]), patch);
  storage.set(store.KEYS.orders, [order]);
  storage.delete(store.KEYS.providerReplyMetrics);
  return order;
}
function createPage(options) {
  const page = { data: clone(pageDefinition.data) };
  Object.keys(pageDefinition).forEach((key) => { if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page); });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad(Object.assign({ audit: "1" }, options)); page.onShow(); return page;
}
function flush() { return new Promise((resolve) => setImmediate(resolve)); }

async function run() {
  seed({ stage: "REQUESTED", contactFirstCopiedAt: null });
  let page = createPage({ id: "AM-260816-01" });
  assert.strictEqual(page.data.currentStep, 1);
  assert.strictEqual(page.data.journeyTitle, "预约沟通发起");
  assert.strictEqual(page.data.replySampleCount, 0);

  seed({ stage: "CONTACTING", contactFirstCopiedAt: null });
  page = createPage({ id: "AM-260816-01" });
  assert.strictEqual(page.data.currentStep, 1, "服务方仅接受预约不能提前进入第2步");
  store.recordContactCopy("AM-260816-01", Date.now());
  page.loadOrder();
  assert.strictEqual(page.data.currentStep, 2, "首次成功复制任一联系方式后需求方必须进入第2步");
  assert.strictEqual(store.findOrder("AM-260816-01").stage, "CONTACTING", "复制联系方式不改变服务方预约请求阶段");

  seed({
    stage: "BUYER_FINAL_CONFIRM", contactFirstCopiedAt: Date.now(), communicationDone: true,
    timePlaceConfirmed: true, serviceScopeConfirmed: true, ndaRequired: false, amountConfirmed: true,
    executable: true, buyerAgreementConfirmedAt: null, paymentStatus: "UNPAID",
    paymentRequest: { timeStamp: "1", nonceStr: "nonce", package: "prepay_id=test", signType: "RSA", paySign: "sign" }
  });
  page = createPage({ id: "AM-260816-01" });
  assert.strictEqual(page.data.currentStep, 3);
  assert.strictEqual(page.data.canConfirmAgreement, true);
  page.confirmAgreement();
  assert.ok(store.findOrder("AM-260816-01").buyerAgreementConfirmedAt);
  assert.strictEqual(store.findOrder("AM-260816-01").stage, "BUYER_FINAL_CONFIRM");

  paymentMode = "cancel";
  page.startPayment();
  await flush();
  assert.strictEqual(store.findOrder("AM-260816-01").stage, "BUYER_FINAL_CONFIRM");
  assert.ok(store.findOrder("AM-260816-01").buyerAgreementConfirmedAt, "取消支付不得要求重新确认合作信息");

  paymentMode = "success";
  page.startPayment();
  await flush();
  assert.strictEqual(paymentCalls, 2);
  assert.strictEqual(store.findOrder("AM-260816-01").paymentStatus, "VERIFYING");
  assert.strictEqual(store.findOrder("AM-260816-01").stage, "BUYER_FINAL_CONFIRM", "前端支付成功回调不得直接进入制作");

  store.updateOrder("AM-260816-01", { paymentStatus: "PAID", paymentTransactionId: "wx-test" });
  page.loadOrder();
  assert.strictEqual(store.findOrder("AM-260816-01").stage, "IN_PRODUCTION", "只有服务端核验支付后才能进入第4步");
  assert.strictEqual(page.data.currentStep, 4);

  seed({
    stage: "BUYER_FINAL_CONFIRM", communicationDone: true, timePlaceConfirmed: true,
    serviceScopeConfirmed: true, ndaRequired: false, amountConfirmed: true, executable: true,
    buyerAgreementConfirmedAt: Date.now(), paymentStatus: "UNPAID", paymentRequest: null
  });
  page = createPage({ id: "AM-260816-01" });
  page.startPayment();
  await flush();
  assert.strictEqual(modalTitle, "支付服务尚未接通");
  assert.strictEqual(store.findOrder("AM-260816-01").stage, "BUYER_FINAL_CONFIRM");

  assert.throws(() => machine.transitionOrder("BUYER_FINAL_CONFIRM", "BUYER_CONFIRMS_EXECUTION"), /Illegal order transition/);
  assert.strictEqual(machine.transitionOrder("BUYER_FINAL_CONFIRM", "PAYMENT_VERIFIED"), "IN_PRODUCTION");

  seed({ stage: "DECLINED", declinePhase: "communication", supplementNote: "条件未达成" });
  page = createPage({ id: "AM-260816-01" });
  page.retryBooking();
  assert.strictEqual(navigatedTo, "/pages/booking/index?providerId=1&repeatOrderId=AM-260816-01");
  page.goMarket();
  assert.strictEqual(switchedTo, "/pages/discover/index");

  process.stdout.write("B04 four-step and payment-gate audit: 24 assertions passed\n");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
