const assert = require("assert");
const storage = new Map();
let definition = null;
let toast = "";
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showToast({ title }) { toast = title; },
  showModal({ success }) { success({ confirm: true }); }
};
global.Page = (value) => { definition = value; };
const store = require("../miniprogram/data/v063-store");
require("../miniprogram/pages/provider-reviews/index.js");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function create(options = {}) {
  const page = { data: clone(definition.data) };
  Object.keys(definition).forEach((key) => { if (key !== "data" && typeof definition[key] === "function") page[key] = definition[key].bind(page); });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad(Object.assign({ audit: "1" }, options)); page.onShow(); return page;
}

let page = create();
assert.strictEqual(page.data.reviews.length, 4);
assert.strictEqual(page.data.rating, "5.0");
const id = page.data.reviews[0].id;
page.reply({ currentTarget: { dataset: { id } } });
assert.strictEqual(toast, "请填写公开回复");
page.update({ currentTarget: { dataset: { id } }, detail: { value: "感谢认可" } });
page.reply({ currentTarget: { dataset: { id } } });
assert.strictEqual(store.findOrder(id).reviewReply, "感谢认可");
assert.strictEqual(page.data.reviews.find((item) => item.id === id).reviewReply, "感谢认可");
assert.strictEqual(page.data.message, "公开回复已发布并同步需求方评价页");
page.reply({ currentTarget: { dataset: { id } } });
assert.ok(toast.includes("不能重复修改"));
assert.strictEqual(store.findOrder(id).reviewReply, "感谢认可");
page = create({ audit: "1", reply: "1" });
assert.ok(page.data.reviews[0].reviewReply.length > 0);
page = create({ audit: "1", empty: "1" });
assert.strictEqual(page.data.reviews.length, 0);
assert.strictEqual(page.data.rating, "—");
process.stdout.write("S07 public-reply immutability audit: 11 assertions passed\n");
