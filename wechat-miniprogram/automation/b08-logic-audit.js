const assert = require("assert");

const storage = new Map();
let pageDefinition = null;
let navigatedTo = "";
let toast = "";
let modalConfirm = true;
let previewed = null;
storage.set("animeMasterProjects", [{
  id: "PJ-AUDIT", title: "夜航者合作项目", shortTitle: "夜航者项目", date: "2026-08-16", city: "杭州",
  location: "杭州 · 具体地点待确认", description: "角色妆造与后期需求", targetImages: ["/assets/careers/zhuangniang.png"], bookingIds: ["AM-260816-01", "AM-260821-05"], projectModelVersion: 2
}]);
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateTo({ url }) { navigatedTo = url; },
  previewImage(options) { previewed = options; },
  showToast({ title }) { toast = title; },
  showModal({ success }) { success({ confirm: modalConfirm, cancel: !modalConfirm }); }
};
global.Page = (definition) => { pageDefinition = definition; };

const helpers = require("../miniprogram/pages/project-detail/index.js");
const projectModel = require("../miniprogram/data/project-model.js");
const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
Object.keys(pageDefinition).forEach((key) => {
  if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
});
page.setData = (patch) => Object.assign(page.data, patch);
page.onLoad({ id: "PJ-AUDIT", audit: "1" });
page.onShow();

assert.deepStrictEqual(page.data.linkedOrders.map((item) => item.orderId), ["AM-260816-01", "AM-260821-05"]);
assert.deepStrictEqual(page.data.linkedOrders.map((item) => item.career), ["妆娘", "后期"]);
assert.strictEqual(page.data.orderCount, 2);
assert.strictEqual(page.data.total, 1360);
assert.deepStrictEqual(page.data.project.targetImages, ["/assets/careers/zhuangniang.png"]);
assert.deepStrictEqual(helpers.formatProjectDescription("服务内容：角色妆造\n普通补充说明"), [
  { label: "服务内容", text: "角色妆造" },
  { label: "", text: "普通补充说明" }
]);
assert.strictEqual(helpers.formatProjectDescription("")[0].text, "此前没有可读取的项目描述，请补充。");
assert.deepStrictEqual(page.data.availableOrders.map((item) => item.orderId), ["AM-260825-09"]);
assert.strictEqual(helpers.destinationFor("REQUESTED"), "booking-status");
assert.strictEqual(helpers.destinationFor("DELIVERY_PENDING"), "fulfillment");

page.openOrder({ currentTarget: { dataset: { index: 0 } } });
assert.strictEqual(navigatedTo, "/pages/booking-status/index?id=AM-260816-01");
page.addOrder();
assert.strictEqual(page.data.selectingOrder, true);
page.linkOrder({ currentTarget: { dataset: { index: 0 } } });
assert.ok(storage.get("animeMasterProjects")[0].bookingIds.includes("AM-260825-09"));
assert.strictEqual(page.data.orderCount, 3);
modalConfirm = false;
page.unlinkOrder({ currentTarget: { dataset: { index: 0 } } });
assert.strictEqual(page.data.orderCount, 3);
modalConfirm = true;
page.unlinkOrder({ currentTarget: { dataset: { index: 0 } } });
assert.strictEqual(page.data.orderCount, 2);
assert.ok(!storage.get("animeMasterProjects")[0].bookingIds.includes("AM-260816-01"));
assert.strictEqual(projectModel.linkOrder("PJ-AUDIT", "AM-260816-01"), null);
page.addOrder();
assert.strictEqual(toast, "暂无可添加的执行中订单");
page.openBrief();
assert.strictEqual(navigatedTo, "/pages/brief/index?id=PJ-AUDIT");
page.previewTargetImage({ currentTarget: { dataset: { index: 0 } } });
assert.strictEqual(previewed.current, "/assets/careers/zhuangniang.png");

process.stdout.write("B08 logic audit: 21 assertions passed\n");
