const assert = require("assert");
const fs = require("fs");
const path = require("path");
const store = require("../miniprogram/data/v063-store");
let pageDefinition = null;
let navigatedTo = "";
let storedGroup = "";
global.wx = {
  getStorageSync() { return undefined; },
  setStorageSync(key, value) { if (key === "anime-master-root-order-group") storedGroup = value; },
  navigateTo({ url }) { navigatedTo = url; },
  switchTab({ url }) { navigatedTo = url; }
};
global.Page = (definition) => { pageDefinition = definition; };
require("../miniprogram/pages/provider-home/index.js");

const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
Object.keys(pageDefinition).forEach((key) => {
  if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
});
page.setData = (patch) => Object.assign(page.data, patch);
page.onLoad({ audit: "1" });
page.onShow();

assert.strictEqual(page.data.profile.nickname, "南烛");
assert.strictEqual(page.data.career, "妆娘");
assert.deepStrictEqual(page.data.metrics.map((item) => item.count), [3, 3, 2]);
assert.strictEqual(page.data.priorityTotal, 4);
assert.strictEqual(page.data.priorityOrders.length, 4);
assert.strictEqual(page.data.remainingPriority, 0);
assert.deepStrictEqual(page.data.overview.map((item) => item.value), ["3 件公开作品", "2 个可预约项目", "6 个公开可约日", "4 条完成订单评价"]);

page.openFlow({ currentTarget: { dataset: { flow: "production" } } });
assert.strictEqual(storedGroup, "production");
assert.strictEqual(navigatedTo, "/pages/orders/index");
page.openPriority({ currentTarget: { dataset: { id: "AM-260816-01" } } });
assert.strictEqual(navigatedTo, "/pages/provider-request/index?id=AM-260816-01");
page.openProfile();
assert.strictEqual(navigatedTo, "/pages/provider-profile/index");
page.openCalendar();
assert.strictEqual(navigatedTo, "/pages/projects/index");
page.openOrders();
assert.strictEqual(navigatedTo, "/pages/orders/index");
page.openReviews();
assert.strictEqual(navigatedTo, "/pages/provider-reviews/index");

const pageRoot = path.resolve(__dirname, "../miniprogram/pages/provider-home");
const markup = fs.readFileSync(path.join(pageRoot, "index.wxml"), "utf8");
const styles = fs.readFileSync(path.join(pageRoot, "index.wxss"), "utf8");
const script = fs.readFileSync(path.join(pageRoot, "index.js"), "utf8");
assert.ok(/class="attention-card"[^>]*data-id="\{\{item\.id\}\}"[^>]*bindtap="openPriority"/.test(markup), "每条预约必须整行复用现有详情入口");
assert.ok(markup.includes('class="priority-list"'), "优先待办必须使用连续列表，而不是独立大卡片堆叠");
assert.ok(markup.includes('class="priority-more"'), "超出工作台预览数量时必须保留查看全部入口");
assert.ok(!markup.includes("attention-action"), "整行可点击时不得再伪造第二个处理按钮");
assert.ok(!markup.includes('class="secondary-block"'), "查看全部属于列表导航，不得伪装成品牌副按钮");
assert.ok(/\.priority-list\s*\{[^}]*overflow:\s*hidden[^}]*border:/s.test(styles), "待办项必须收拢为连续列表容器");
assert.ok(/\.attention-card, \.priority-more\s*\{[^}]*min-height:\s*112rpx[^}]*border-bottom:/s.test(styles), "单条预约必须保持紧凑且有 44px 以上整行热区");
assert.ok(script.includes("const PRIORITY_PREVIEW_LIMIT = 5;"), "工作台最多预览 5 条，更多进入既有订单列表");

const getOrders = store.getOrders;
const baseOrders = getOrders();
const prioritySeed = baseOrders.find((order) => order.providerId === store.CURRENT_PROVIDER_ID && order.stage === "REQUESTED");
store.getOrders = () => baseOrders.concat([1, 2, 3].map((suffix) => Object.assign({}, prioritySeed, { id: `AM-STRESS-0${suffix}` })));
page.onShow();
assert.strictEqual(page.data.priorityTotal, 7, "高频服务方的优先待办总数必须保持真实计数");
assert.strictEqual(page.data.priorityOrders.length, 5, "工作台只预览 5 条，避免几十条记录拖慢首页");
assert.strictEqual(page.data.remainingPriority, 2, "超出预览数量的待办必须进入查看全部入口");
store.getOrders = getOrders;

process.stdout.write("S01 logic and UI contract audit: 24 assertions passed\n");
