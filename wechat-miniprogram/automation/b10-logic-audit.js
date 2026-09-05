const assert = require("assert");
const storage = new Map();
let definition = null;
let navigatedTo = "";
let rootTarget = "";
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateTo({ url }) { navigatedTo = url; },
  reLaunch({ url }) { rootTarget = url; },
  switchTab({ url }) { rootTarget = url; },
  showToast() {},
  showModal({ success }) { success({ confirm: true }); }
};
global.Page = (value) => { definition = value; };
const store = require("../miniprogram/data/v063-store");
require("../miniprogram/pages/fulfillment/index.js");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function reset() { storage.set(store.KEYS.orders, clone(store.initialOrders)); }
function create(options) {
  const page = { data: clone(definition.data) };
  Object.keys(definition).forEach((key) => { if (key !== "data" && typeof definition[key] === "function") page[key] = definition[key].bind(page); });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad(Object.assign({ audit: "1" }, options)); page.onShow(); return page;
}

reset();
const online = create({ id: "AM-260823-07" });
assert.strictEqual(online.data.validStage, true);
assert.strictEqual(online.data.onsite, false);
assert.strictEqual(online.data.canRevise, false);
assert.strictEqual(online.data.canAccept, true);
online.updateRevision({ detail: { value: "请降低第二张图片的背景高光" } });
assert.strictEqual(online.data.canRevise, true);
online.revise();
assert.strictEqual(store.findOrder("AM-260823-07").stage, "REVISION_REQUESTED");
assert.strictEqual(online.data.validStage, false);

reset();
const onsite = create({ id: "AM-260825-09" });
assert.strictEqual(onsite.data.onsite, true);
assert.strictEqual(onsite.data.canAccept, true);
onsite.accept();
assert.strictEqual(store.findOrder("AM-260825-09").stage, "COMPLETED");
assert.strictEqual(onsite.data.validStage, true);

reset();
const orders = storage.get(store.KEYS.orders);
const missingEvidence = orders.find((item) => item.id === "AM-260823-07");
Object.assign(missingEvidence, { deliveryNote: "", deliveryFiles: [] });
storage.set(store.KEYS.orders, orders);
const blocked = create({ id: "AM-260823-07" });
assert.strictEqual(blocked.data.canAccept, false);
assert.strictEqual(blocked.data.acceptIssues.length, 2);
blocked.accept();
assert.strictEqual(store.findOrder("AM-260823-07").stage, "DELIVERY_PENDING");

const completed = create({ id: "AM-260824-08" });
assert.strictEqual(completed.data.order.stage, "COMPLETED");
completed.goReview();
assert.strictEqual(navigatedTo, "/pages/review/index?id=AM-260824-08");
completed.goOrders();
assert.strictEqual(rootTarget, "/pages/orders/index");
const invalid = create({ id: "AM-260821-05" });
assert.strictEqual(invalid.data.validStage, false);
process.stdout.write("B10 delivery-evidence and acceptance-confirmation audit: 18 assertions passed\n");
