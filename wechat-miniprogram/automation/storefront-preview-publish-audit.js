const assert = require("assert");
const storage = new Map();
let pageDefinition = null;
let toast = "";
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showToast({ title }) { toast = title; }
};
global.Page = (definition) => { pageDefinition = definition; };

const store = require("../miniprogram/data/v063-store");
const previewDraft = require("../miniprogram/data/storefront-preview-draft");
const publishedProfile = store.getProfile();
previewDraft.stage({
  providerId: store.CURRENT_PROVIDER_ID,
  profile: Object.assign({}, publishedProfile, { city: "预览草稿城市" }),
  services: store.getServices(),
  works: store.getWorks(),
  pinnedWorkIds: store.getPinnedWorkIds(),
  noticeImage: store.getNoticeImage()
});
require("../miniprogram/pages/provider-detail/index.js");

function create(options) {
  const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
  Object.keys(pageDefinition).forEach((key) => {
    if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
  });
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch);
    if (callback) callback();
  };
  page.onLoad(options);
  return page;
}

const draftPage = create({ id: store.CURRENT_PROVIDER_ID, workspace: "provider", preview: "storefront", audit: "1" });
assert.strictEqual(draftPage.data.provider.city, "预览草稿城市");
assert.strictEqual(draftPage.data.storefrontDraftPreview, true);
assert.strictEqual(storage.get(store.KEYS.profile), undefined, "打开预览不得覆盖正式橱窗");
draftPage.confirmPublish();
assert.strictEqual(storage.get(store.KEYS.profile).city, "预览草稿城市", "确认后才允许写入正式橱窗");
assert.strictEqual(draftPage.data.previewPublished, true);
assert.strictEqual(previewDraft.isPublished(), true);
assert.strictEqual(toast, "橱窗已发布");

previewDraft.clear();
const publishedPreview = create({ id: store.CURRENT_PROVIDER_ID, workspace: "provider", audit: "1" });
assert.strictEqual(publishedPreview.data.providerPreview, true);
assert.strictEqual(publishedPreview.data.storefrontDraftPreview, false, "普通橱窗预览不得出现确认发布状态");

process.stdout.write("Storefront preview publish boundary audit passed\n");
