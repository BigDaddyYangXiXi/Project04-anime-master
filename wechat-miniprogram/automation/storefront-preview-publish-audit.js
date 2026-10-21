const assert = require("assert");
const storage = new Map();
let pageDefinition = null;
let toast = "";
global.wx = {
  getDeviceInfo() { return { platform: "devtools" }; },
  getAccountInfoSync() { return { miniProgram: { envVersion: "develop" } }; },
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
assert.strictEqual(draftPage.auditMode, true, "本项仅验证明确开启的本地预览，不得误走云端分支");
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

const fs = require("node:fs"), path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "../miniprogram", file), "utf8");
const editor = read("pages/provider-profile/index.wxml"), preview = read("pages/provider-detail/index.wxml"), stage = read("templates/publication-stage.wxml"), styles = read("styles/publication-stage.wxss");
assert.ok(editor.includes("保存草稿，下一步") && editor.includes('is="publication-stage"'), "编辑页须明确保存草稿并展示两步发布说明");
assert.ok(stage.includes("保存草稿 ≠ 公开发布") && stage.includes("本次内容尚未公开"), "草稿与发布预览必须明确区分");
assert.ok(preview.includes('wx:if="{{storefrontDraftPreview && !visitorDraftPreview}}" class="am-publication-actions"') && preview.includes("确认并公开发布"), "发布确认只在发布预览的独立操作区出现");
assert.ok(preview.includes('<main-bottom-nav wx:if="{{!storefrontDraftPreview || visitorDraftPreview}}"'), "发布确认页须隐藏主底栏，普通/访客预览保留");
assert.ok(/\.am-publication-actions[^}]*position:\s*fixed[^}]*env\(safe-area-inset-bottom\)/s.test(styles), "发布操作区须固定并保留原生安全区");
assert.ok(styles.includes("var(--am-color-control-surface)") && styles.includes("var(--am-color-brand)"), "保存及发布提示须分别使用现行中性与品牌强调样式");
process.stdout.write("Storefront preview publish boundary and current UI contract audit passed\n");
