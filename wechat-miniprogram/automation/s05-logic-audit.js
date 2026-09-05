const assert = require("assert");
const storage = new Map();
let definition = null;
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showModal({ success }) { success({ confirm: true }); }
};
global.Page = (value) => { definition = value; };
const store = require("../miniprogram/data/v063-store");
require("../miniprogram/pages/provider-task/index.js");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function create(options) {
  const page = { data: clone(definition.data) };
  Object.keys(definition).forEach((key) => { if (key !== "data" && typeof definition[key] === "function") page[key] = definition[key].bind(page); });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad(Object.assign({ audit: "1" }, options)); page.onShow(); return page;
}

let page = create({ id: "AM-260816-01", audit: "1", state: "buyer" });
assert.strictEqual(page.data.waitingBuyer, true);
assert.strictEqual(page.data.canSign, false);
page = create({ id: "AM-260816-01", audit: "1", state: "provider" });
assert.strictEqual(page.data.canSign, true);
assert.strictEqual(page.data.order.buyerNdaSigned, true);
page = create({ id: "AM-260816-01", audit: "1", state: "final" });
assert.strictEqual(page.data.finalConfirm, true);

let orders = clone(store.initialOrders);
Object.assign(orders[0], { stage: "NDA_PROVIDER_PENDING", ndaRequired: true, buyerNdaSigned: true, providerNdaSigned: false });
storage.set(store.KEYS.orders, orders);
page = create({ id: "AM-260816-01" });
page.sign();
assert.strictEqual(store.findOrder("AM-260816-01").stage, "BUYER_FINAL_CONFIRM");
assert.strictEqual(store.findOrder("AM-260816-01").providerNdaSigned, true);

orders = clone(store.initialOrders);
Object.assign(orders[0], { stage: "NDA_PROVIDER_PENDING", ndaRequired: true, buyerNdaSigned: false, providerNdaSigned: false });
storage.set(store.KEYS.orders, orders);
page = create({ id: "AM-260816-01" });
assert.strictEqual(page.data.canSign, false);
assert.ok(page.data.signIssues.some((item) => item.includes("需求方")));
process.stdout.write("S05 signature-order and fact-gate audit: 9 assertions passed\n");
