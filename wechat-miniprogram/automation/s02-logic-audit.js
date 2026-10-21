const assert = require("assert");
const storage = new Map();
let pageDefinition = null;
let navigatedTo = "";
let navigatedBack = false;
let redirectedTo = "";
let toast = "";
let removedFile = "";
let navigateCount = 0;
let navigateShouldFail = false;
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  navigateTo({ url, fail }) {
    navigatedTo = url;
    navigateCount += 1;
    if (navigateShouldFail && fail) fail({ errMsg: "navigateTo:fail audit" });
  },
  navigateBack() { navigatedBack = true; },
  redirectTo({ url }) { redirectedTo = url; },
  showToast({ title }) { toast = title; },
  getFileSystemManager() { return { readFile() {} }; },
  removeSavedFile({ filePath }) { removedFile = filePath; },
  chooseMedia() {}
};
global.Page = (definition) => { pageDefinition = definition; };
require("../miniprogram/pages/provider-profile/index.js");
const storefrontPreviewDraft = require("../miniprogram/data/storefront-preview-draft");

function setPath(target, path, value) {
  const keys = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current = target;
  keys.slice(0, -1).forEach((key) => { current = current[key]; });
  current[keys[keys.length - 1]] = value;
}

function create(options = {}) {
  const page = { data: JSON.parse(JSON.stringify(pageDefinition.data)) };
  Object.keys(pageDefinition).forEach((key) => {
    if (key !== "data" && typeof pageDefinition[key] === "function") page[key] = pageDefinition[key].bind(page);
  });
  page.setData = (patch, callback) => {
    page.lastPatch = patch;
    Object.keys(patch).forEach((key) => setPath(page.data, key, patch[key]));
    if (callback) callback();
  };
  page.onLoad(Object.assign({ audit: "1" }, options));
  page.onShow();
  return page;
}

const page = create();
assert.strictEqual(page.data.editing, true, "进入 S02 必须直接进入编辑态，不得显示独立服务橱窗中转页");
assert.strictEqual(page.data.profile.nickname, "南烛");
assert.strictEqual(page.data.services.length, 2);
assert.strictEqual(page.data.works.length, 3);
assert.deepStrictEqual(page.data.pinnedWorkIds, ["w-mu-1"]);
assert.strictEqual(page.data.canPublish, true);
assert.strictEqual(page.data.selectedWork.id, "w-mu-1");
assert.strictEqual(page.data.serviceEditors[0].expanded, true);
assert.strictEqual(page.data.serviceEditors[1].expanded, false);
page.toggleServiceEditor({ currentTarget: { dataset: { id: page.data.serviceEditors[0].id } } });
assert.strictEqual(page.data.serviceEditors[0].expanded, false);
page.toggleServiceEditor({ currentTarget: { dataset: { id: page.data.serviceEditors[0].id } } });
assert.strictEqual(page.data.serviceEditors[0].expanded, true);
page.openWorkPicker({ currentTarget: { dataset: { index: 0 } } });
assert.strictEqual(page.data.workPickerOpen, true);
assert.strictEqual(page.data.workPickerOptions.length, page.data.workDrafts.length);
const pickerTarget = page.data.workPickerOptions.find((item) => !item.checked) || page.data.workPickerOptions[0];
const wasPicked = page.data.workPickerDraftIds.includes(pickerTarget.id);
page.toggleWorkPickerWork({ currentTarget: { dataset: { id: pickerTarget.id } } });
page.closeWorkPicker();
assert.strictEqual(page.data.serviceDrafts[0].workIds.includes(pickerTarget.id), wasPicked, "取消作品选择不得写入服务草稿");
page.openWorkPicker({ currentTarget: { dataset: { index: 0 } } });
page.toggleWorkPickerWork({ currentTarget: { dataset: { id: pickerTarget.id } } });
page.confirmWorkPicker();
assert.strictEqual(page.data.workPickerOpen, false);
assert.strictEqual(page.data.serviceDrafts[0].workIds.includes(pickerTarget.id), !wasPicked);
const originalWorkDrafts = JSON.parse(JSON.stringify(page.data.workDrafts));
page.setData({ workDrafts: page.data.workDrafts.slice(0, 2) }, () => page.refreshDerived());
assert.strictEqual(page.data.canPublish, true, "作品数量不再限制发布，已有作品仍须完整");
page.setData({ workDrafts: originalWorkDrafts }, () => page.refreshDerived());
assert.strictEqual(page.data.canPublish, true);
page.updateProfile({ currentTarget: { dataset: { key: "nickname" } }, detail: { value: "不可写昵称" } });
assert.strictEqual(page.data.profileDraft.nickname, "南烛", "橱窗编辑器不得修改账号昵称");
page.updateProfile({ currentTarget: { dataset: { key: "city" } }, detail: { value: "上海" } });
assert.strictEqual(page.lastPatch["profileDraft.city"], "上海", "资料输入必须只跨层更新当前字段");
page.updateProfile({ currentTarget: { dataset: { key: "tags" } }, detail: { value: "男角，骨相调整, 男角, " } });
assert.deepStrictEqual(page.data.profileTagPreview, ["男角", "骨相调整"], "主页标签输入必须即时去重呈现");
assert.strictEqual(Object.prototype.hasOwnProperty.call(page.lastPatch, "profileDraft"), false, "资料输入不得重传完整草稿对象");
page.updateService({ currentTarget: { dataset: { index: 0, key: "description" } }, detail: { value: "精确更新服务描述" } });
assert.strictEqual(page.lastPatch["serviceDrafts[0].description"], "精确更新服务描述", "服务输入必须只跨层更新当前字段");
assert.strictEqual(Object.prototype.hasOwnProperty.call(page.lastPatch, "serviceDrafts"), false, "服务输入不得重传完整服务数组");
page.updateWork({ currentTarget: { dataset: { key: "description" } }, detail: { value: "精确更新作品描述" } });
assert.strictEqual(page.lastPatch["workDrafts[0].description"], "精确更新作品描述", "作品输入必须只跨层更新当前字段");
assert.strictEqual(Object.prototype.hasOwnProperty.call(page.lastPatch, "workDrafts"), false, "作品输入不得重传包含图片路径的完整作品数组");
page.updateWork({ currentTarget: { dataset: { key: "subtitle" } }, detail: { value: "需求方可见副标题" } });
assert.strictEqual(page.lastPatch["workDrafts[0].subtitle"], "需求方可见副标题", "详情页副标题必须由橱窗对应字段编辑");
page.updateWork({ currentTarget: { dataset: { key: "tagsText" } }, detail: { value: "男角, 骨相调整，男角" } });
assert.deepStrictEqual(page.data.selectedWorkTagPreview, ["男角", "骨相调整"], "作品标签输入必须即时复用作品卡标签预览");
page.data.workDrafts[0].imagePreviews = ["published-image", "pending-image"];
page.data.selectedWork = page.data.workDrafts[0];
page.pendingSavedFiles = ["pending-image"];
page.removeWorkImage({ currentTarget: { dataset: { index: 1 } } });
assert.deepStrictEqual(page.data.workDrafts[0].imagePreviews, ["published-image"], "服务方必须能够从作品草稿移除指定图片");
assert.strictEqual(removedFile, "pending-image", "移除本轮新选图片时必须清理对应临时保存文件");
assert.deepStrictEqual(page.pendingSavedFiles, [], "已移除的新选图片不得遗留在待发布文件列表");
page.addService();
assert.strictEqual(page.data.canPublish, false);
page.deleteService({ currentTarget: { dataset: { index: 2 } } });
assert.strictEqual(page.data.canPublish, true);
page.updateServiceWorks({ currentTarget: { dataset: { index: 0 } }, detail: { value: ["w-mu-1", "w-mu-2"] } });
assert.deepStrictEqual(page.data.serviceDrafts[0].workIds, ["w-mu-1", "w-mu-2"]);
assert.strictEqual(page.data.serviceDrafts[1].workIds.includes("w-mu-1"), false);
page.togglePortfolioPin({ currentTarget: { dataset: { id: "w-mu-2" } } });
assert.strictEqual(page.data.pinnedDraft.length, 2);
page.togglePortfolioPin({ currentTarget: { dataset: { id: "w-mu-3" } } });
assert.strictEqual(page.data.pinnedDraft.length, 2, "作品集最多只能置顶 2 件作品");
assert.strictEqual(toast, "最多置顶 2 件作品，请先取消一件");
page.openWorkEditor({ currentTarget: { dataset: { id: "w-mu-2" } } });
assert.strictEqual(navigatedTo, "/pages/provider-profile/index?edit=1&section=works&workId=w-mu-2&audit=1", "审计夹具点击作品卡必须进入同一个审计单件作品编辑器");
page.openNewWorkEditor();
assert.strictEqual(navigatedTo, "/pages/provider-profile/index?edit=1&section=works&audit=1", "审计夹具上传新作品必须复用同一审计编辑入口");
const publishedCityBeforePreview = page.data.profile.city;
page.saveAndPreview();
assert.strictEqual(page.data.editing, true);
assert.strictEqual(storage.get("anime-master-v063-profile"), undefined, "保存并预览不得提前覆盖已发布橱窗");
assert.strictEqual(storefrontPreviewDraft.get().profile.city, "上海");
assert.strictEqual(storefrontPreviewDraft.get().works[0].subtitle, "需求方可见副标题");
assert.deepStrictEqual(storefrontPreviewDraft.get().pinnedWorkIds, ["w-mu-1", "w-mu-2"]);
assert.strictEqual(navigatedTo, "/pages/provider-detail/index?id=1&workspace=provider&preview=storefront&audit=1", "审计保存后必须进入待确认的审计橱窗预览");
page.previewBuyer();
assert.strictEqual(navigatedTo, "/pages/provider-detail/index?id=1&workspace=provider&audit=1");

const cancelled = create();
cancelled.updateProfile({ currentTarget: { dataset: { key: "city" } }, detail: { value: "未保存城市" } });
navigatedBack = false;
cancelled.cancelEdit();
assert.strictEqual(navigatedBack, true, "取消修改必须直接返回来源，不得落到旧服务橱窗页");
assert.strictEqual(cancelled.data.profile.city, publishedCityBeforePreview, "取消修改必须恢复最近一次已发布内容");
assert.strictEqual(storage.get("anime-master-v063-profile"), undefined, "取消修改不得发布预览草稿");

const repeatSave = create();
navigateCount = 0;
repeatSave.saveAndPreview();
repeatSave.saveAndPreview();
assert.strictEqual(navigateCount, 1, "保存并预览处理中必须阻止重复跳转");

const failedPreview = create();
navigateShouldFail = true;
failedPreview.saveAndPreview();
navigateShouldFail = false;
assert.strictEqual(failedPreview.data.editing, true, "预览打开失败后必须恢复编辑页，不能显示空白中间态");
assert.strictEqual(failedPreview.data.saving, false);
assert.strictEqual(toast, "预览打开失败，本次修改已保留");
assert.strictEqual(storefrontPreviewDraft.get(), null, "预览跳转失败不得遗留失效预览草稿");

const uploader = create({ edit: "1", section: "works" });
assert.strictEqual(uploader.data.editing, true);
assert.strictEqual(uploader.data.isNewWork, true);
assert.strictEqual(uploader.data.selectedWork.title, "", "新建作品不得预填虚构标题");
assert.strictEqual(uploader.data.canSaveWork, false, "未上传图片的作品不得保存");
uploader.updateWork({ currentTarget: { dataset: { key: "title" } }, detail: { value: "新上传作品" } });
uploader.updateWork({ currentTarget: { dataset: { key: "description" } }, detail: { value: "真实作品描述" } });
uploader.updateWork({ currentTarget: { dataset: { key: "price" } }, detail: { value: "680" } });
const uploadIndex = uploader.data.selectedWorkIndex;
uploader.data.workDrafts[uploadIndex].imagePreviews = ["saved-work-image"];
uploader.data.selectedWork = uploader.data.workDrafts[uploadIndex];
uploader.refreshDerived();
assert.strictEqual(uploader.data.canSaveWork, true);
uploader.saveWork();
assert.strictEqual(navigatedBack, true, "保存单件作品后必须返回原橱窗页");
assert.ok(storage.get("anime-master-v063-works").some((work) => work.title === "新上传作品" && work.imagePreviews[0] === "saved-work-image"), "新作品必须写入作品详情使用的同一数据源");
assert.strictEqual(redirectedTo, "");

const invalid = create({ audit: "1", edit: "1", invalid: "1" });
assert.strictEqual(invalid.data.editing, true);
assert.strictEqual(invalid.data.canPublish, false);
process.stdout.write("S02 logic, compact editor and input-payload audit passed\n");
