const assert = require("assert");
const storage = new Map();
let definition = null;
let navigatedTo = "";
let redirectedTo = "";
let rootTarget = "";
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateTo({ url }) { navigatedTo = url; },
  redirectTo({ url }) { redirectedTo = url; },
  reLaunch({ url }) { rootTarget = url; },
  switchTab({ url }) { rootTarget = url; }
};
global.Page = (value) => { definition = value; };
const store = require("../miniprogram/data/v063-store");
require("../miniprogram/pages/order-detail/index.js");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function seed(stage, patch = {}) {
  const orders = clone(store.initialOrders);
  Object.assign(orders[0], { stage }, patch);
  storage.set(store.KEYS.orders, orders);
}
function create(options) {
  const page = { data: clone(definition.data) };
  Object.keys(definition).forEach((key) => { if (key !== "data" && typeof definition[key] === "function") page[key] = definition[key].bind(page); });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad(Object.assign({ audit: "1" }, options)); page.onShow(); return page;
}

for (const stage of ["REQUESTED", "CONTACTING", "NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM"]) {
  seed(stage, { communicationDone: true, ndaRequired: stage.includes("NDA"), executable: true });
  const page = create({ id: "AM-260816-01" });
  assert.strictEqual(page.data.bookingInProgress, true);
  assert.strictEqual(page.data.canBuyerSign, false);
  assert.strictEqual(page.data.canConfirm, false);
  page.goBookingStatus();
  assert.strictEqual(redirectedTo, "/pages/booking-status/index?id=AM-260816-01");
}

for (const [state, key] of [["production", "inProduction"], ["revision", "inProduction"], ["completed", "completed"]]) {
  const page = create({ id: "AM-260816-01", audit: "1", state });
  assert.strictEqual(page.data.bookingInProgress, false);
  assert.strictEqual(page.data[key], true);
}
let page = create({ id: "AM-260816-01", audit: "1", state: "completed" });
page.goProject();
assert.strictEqual(rootTarget, "/pages/projects/index");
page.goReview();
assert.strictEqual(navigatedTo, "/pages/review/index?id=AM-260816-01");
process.stdout.write("B06 no-bypass and production-detail audit: 25 assertions passed\n");
