const assert = require("assert");
const storage = new Map();
let pageDefinition = null;
let navigatedTo = "";
let switchedTo = "";
let chooseMediaOptions = null;
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateTo({ url }) { navigatedTo = url; },
  chooseMedia(options) { chooseMediaOptions = options; },
  switchTab({ url }) { switchedTo = url; }
};
global.Page = (definition) => { pageDefinition = definition; };
require("../miniprogram/pages/me/index.js");

function create(options = {}) {
  const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
  Object.keys(pageDefinition).forEach((key) => {
    if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
  });
  page.setData = (patch) => Object.assign(page.data, patch);
  page.onLoad(Object.assign({ audit: "1" }, options));
  page.onShow();
  return page;
}

const buyer = create();
assert.strictEqual(buyer.data.role, "buyer");
assert.strictEqual(buyer.data.assets.length, 3);
assert.strictEqual(buyer.data.buyerStats.length, 3);
assert.ok(buyer.data.buyerStats.every((item) => item.value === "—"));
assert.strictEqual(buyer.data.account.nickname, "未设置昵称");
buyer.openBuyerOrders();
assert.strictEqual(switchedTo, "/pages/orders/index");
buyer.openBuyerProjects();
assert.strictEqual(switchedTo, "/pages/projects/index");
buyer.switchIdentity();
assert.strictEqual(storage.get("animeMasterRole"), "provider");
assert.strictEqual(switchedTo, "/pages/discover/index");
storage.set("anime-master-v063-me-dashboard", { provider: {
  account: { nickname: "已同步昵称", avatar: "" },
  storefrontStatus: "PUBLISHED", publishedWorksCount: 7,
  metrics: { completedOrders: 12, createdWorks: 7, workReferences: 31, workFavorites: 18, accountFollowers: 9 },
  contentAssets: { followed: 4, liked: 6, referenced: 2 }
} });
const provider = create({ audit: "1", role: "provider" });
assert.strictEqual(provider.data.role, "provider");
assert.strictEqual(provider.data.providerStats.length, 5);
assert.strictEqual(provider.data.account.nickname, "已同步昵称");
assert.deepStrictEqual(provider.data.providerStats.map((item) => item.value), [12, 7, 31, 18, 9]);
assert.strictEqual(provider.data.previewMeta, "7 件作品正在公开展示");
assert.strictEqual(provider.data.storefrontStatusText, "橱窗已公开");
provider.previewStorefront();
assert.strictEqual(navigatedTo, "/pages/provider-detail/index?id=1&workspace=provider&audit=1");
provider.editStorefront();
assert.strictEqual(navigatedTo, "/pages/provider-profile/index?edit=1&section=profile&audit=1");
assert.strictEqual(storage.get("animeMasterRole"), "provider");
provider.uploadWork();
assert.deepStrictEqual(chooseMediaOptions.sourceType, ["album"]);
assert.deepStrictEqual(chooseMediaOptions.mediaType, ["image"]);
navigatedTo = "";
chooseMediaOptions.fail({ errMsg: "chooseMedia:fail cancel" });
assert.strictEqual(navigatedTo, "", "取消相册选择必须停留在我的页");
chooseMediaOptions.success({ tempFiles: [{ tempFilePath: "tmp/work.jpg", size: 1024 }] });
assert.strictEqual(navigatedTo, "/pages/provider-profile/index?edit=1&section=works&audit=1");
provider.openFunds();
assert.strictEqual(navigatedTo, "/pages/funds/index");
process.stdout.write("M01 logic and backend snapshot audit passed\n");
