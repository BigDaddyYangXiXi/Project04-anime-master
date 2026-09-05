const store = require("../../data/v063-store");
const { providers } = require("../../data/v063");
const pendingWorkUpload = require("../../data/pending-work-upload");
const storefrontPreviewDraft = require("../../data/storefront-preview-draft");
const { chooseWorkMedia } = require("../../utils/work-media-picker");
const cloudCatalog = require("../../services/cloud-catalog");
const { sanitizeYuanInput } = require("../../utils/input-normalization");
const { pickerRegion } = require("../../utils/discovery-region");

const SERVICE_MODES = [
  { value: "ONSITE", label: "到场服务" },
  { value: "ONLINE", label: "线上服务" },
  { value: "BOTH", label: "到场或线上" }
];
const CAREERS = ["妆娘", "毛娘", "摄影", "后期"];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeWorks(works) {
  return works.map((work) => Object.assign({}, work, {
    imagePreviews: Array.isArray(work.imagePreviews) ? work.imagePreviews : [],
    tagsText: (work.tags || []).join(",")
  }));
}
function parseTags(value) {
  return Array.from(new Set(String(value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean)));
}
function normalizeServices(services) {
  return (services || []).map((service) => Object.assign({}, service, {
    serviceMode: SERVICE_MODES.some((item) => item.value === service.serviceMode) ? service.serviceMode : "ONSITE",
    serviceAreas: Array.isArray(service.serviceAreas) ? service.serviceAreas : []
  }));
}
function canPublish(profile, services, works) {
  const servicesValid = services.length > 0 && services.every((service) =>
    service.name.trim() && service.description.trim() && service.unit.trim() && Number(service.price) > 0
    && SERVICE_MODES.some((item) => item.value === service.serviceMode)
  );
  const worksValid = works.length >= 3 && works.every((work) =>
    work.title.trim() && work.description.trim() && Number(work.price) > 0
    && ((work.imageAssetIds || []).length > 0 || (work.imagePreviews || []).length > 0 || Number(work.imageCount) > 0)
  );
  return Boolean(profile && profile.nickname && profile.nickname.trim() && CAREERS.includes(profile.career) && /^\d{6}$/.test(profile.cityCode || "") && servicesValid && worksValid);
}
function canSaveWork(work) {
  return Boolean(work && work.title.trim() && work.description.trim() && Number(work.price) > 0 && (work.imagePreviews || []).length > 0);
}
function createWorkDraft() {
  const timestamp = Date.now();
  const stamp = timestamp.toString(36).toUpperCase().slice(-5);
  return {
    id: `work-${timestamp}`, code: `AM-MU-${stamp}`, title: "", subtitle: "", tone: "coral",
    price: 0, description: "", tags: [], tagsText: "", referenceCount: 0,
    imageCount: 0, imagePreviews: []
  };
}

Page({
  data: {
    editing: false, career: "", accountNickname: "", profile: null, profileDraft: null, editorSection: "all", navTitle: "编辑服务橱窗",
    services: [], serviceDrafts: [], serviceEditors: [], works: [], workDrafts: [], workEditors: [],
    pinnedWorkIds: [], pinnedDraft: [], selectedWorkIndex: 0, selectedWork: null,
    noticeImage: "", noticeImageDraft: "", noticeImageAssetId: null, selectedIsPinned: false, canPublish: false, canSaveWork: false, isNewWork: false, saving: false,
    cloudLoading: false, cloudError: "", remoteEnabled: false, remoteDraftVersion: 0, hasPendingMedia: false, hasRejectedMedia: false,
    serviceExpandedIds: [], workPickerOpen: false, workPickerServiceIndex: -1, workPickerDraftIds: [], workPickerOptions: [],
    profileTagPreview: [], selectedWorkTagPreview: [], serviceModeOptions: SERVICE_MODES.map((item) => item.label), careerOptions: CAREERS
  },

  onLoad(options = {}) {
    this.pendingSavedFiles = [];
    this.pendingCloudAssets = [];
    this.requestSection = options.section || "";
    this.requestWorkId = options.workId || "";
    this.setData({
      editorSection: this.requestSection === "works" ? "works" : this.requestSection === "profile" ? "profile" : "all",
      navTitle: this.requestSection === "works" ? (this.requestWorkId ? "编辑作品" : "上传作品") : "编辑服务橱窗"
    });
    this.auditInvalid = options.audit === "1" && options.invalid === "1";
    this.auditTwoWorks = options.audit === "1" && options.twoWorks === "1";
    this.auditMode = options.audit === "1";
  },

  onShow() {
    if (this.previewOpen) {
      this.previewOpen = false;
      this.setData({ saving: false });
      if (storefrontPreviewDraft.consumePublished()) {
        this.pendingSavedFiles = [];
        this.pendingCloudAssets = [];
        this.setData({ editing: false });
        if (!this.auditMode) this.loadCloudEditor();
        else this.openEditor();
      }
      return;
    }
    if (!this.auditMode) {
      this.loadCloudEditor();
      return;
    }
    if (this.data.editing) {
      if (this.data.editorSection !== "works") {
        const works = store.getWorks();
        this.setData({ works, workDrafts: normalizeWorks(clone(works)) }, () => this.refreshDerived());
      }
      return;
    }
    const migration = store.migrateLegacyMedia();
    if (!migration) {
      this.openEditor();
      return;
    }
    migration.catch(() => {
      wx.showToast({ title: "旧图片迁移失败，请重新选择图片", icon: "none" });
    }).then(() => this.openEditor());
  },

  loadCloudEditor() {
    if (this.data.cloudLoading) return;
    this.setData({ cloudLoading: true, cloudError: "", remoteEnabled: true });
    cloudCatalog.getDraft().then(({ version, clientDraft, providerId }) => {
      this.serverProviderId = providerId;
      this.setData({
        career: clientDraft.career,
        accountNickname: clientDraft.profile.nickname,
        profile: clientDraft.profile,
        services: normalizeServices(clientDraft.services),
        works: clientDraft.works,
        pinnedWorkIds: clientDraft.pinnedWorkIds,
        noticeImage: clientDraft.noticeImage,
        noticeImageAssetId: clientDraft.noticeImageAssetId,
        remoteDraftVersion: version,
        cloudLoading: false,
        cloudError: ""
      }, () => this.beginEdit());
    }).catch((error) => {
      this.setData({ cloudLoading: false, cloudError: error.code === "VERSION_CONFLICT" ? "草稿已更新，请重新加载" : "云端橱窗载入失败，请重试" });
    });
  },

  retryCloudLoad() {
    this.loadCloudEditor();
  },

  openEditor() {
    this.loadPublished();
    this.setData({ saving: false });
    this.beginEdit();
    if (!this.auditApplied) {
      if (this.auditInvalid) this.setData({ "profileDraft.nickname": "", canPublish: false });
      if (this.auditTwoWorks) {
        this.setData({ workDrafts: normalizeWorks(clone(this.data.works)).slice(0, 2) }, () => this.refreshDerived());
      }
      this.auditApplied = true;
    }
  },

  loadPublished() {
    const provider = providers.find((item) => item.id === store.CURRENT_PROVIDER_ID) || providers[0];
    this.setData({
      career: provider.career,
      accountNickname: store.getAccount("provider").nickname || "",
      profile: store.getProfile(),
      services: normalizeServices(store.getServices()),
      works: store.getWorks(),
      pinnedWorkIds: store.getPinnedWorkIds(),
      noticeImage: store.getNoticeImage()
    });
  },

  beginEdit() {
    const workDrafts = normalizeWorks(clone(this.data.works));
    if (this.data.editorSection === "works") {
      const requestedIndex = workDrafts.findIndex((work) => work.id === this.requestWorkId);
      const isNewWork = requestedIndex < 0;
      const nextDrafts = isNewWork ? workDrafts.concat(createWorkDraft()) : workDrafts;
      const selectedWorkIndex = isNewWork ? nextDrafts.length - 1 : requestedIndex;
      this.setData({
        editing: true,
        profileDraft: Object.assign({}, clone(this.data.profile), { nickname: this.data.accountNickname, career: this.data.career }),
        serviceDrafts: normalizeServices(clone(this.data.services)),
        pinnedDraft: clone(this.data.pinnedWorkIds).slice(0, 2),
        noticeImageDraft: this.data.noticeImage,
        workDrafts: nextDrafts,
        selectedWorkIndex,
        selectedWork: nextDrafts[selectedWorkIndex],
        isNewWork
      }, () => {
        this.refreshDerived();
        if (isNewWork) this.consumeEntryUpload();
      });
      return;
    }
    this.setData({
      editing: true,
      profileDraft: Object.assign({}, clone(this.data.profile), { nickname: this.data.accountNickname, career: this.data.career }),
      serviceDrafts: normalizeServices(clone(this.data.services)),
      workDrafts,
      serviceExpandedIds: this.data.services[0] ? [this.data.services[0].id] : [],
      pinnedDraft: clone(this.data.pinnedWorkIds).slice(0, 2),
      noticeImageDraft: this.data.noticeImage,
      selectedWorkIndex: 0,
      selectedWork: workDrafts[0] || null
    }, () => this.refreshDerived());
  },

  refreshDerived() {
    const profile = this.data.profileDraft || {};
    const selectedWork = this.data.workDrafts[this.data.selectedWorkIndex] || null;
    this.setData({
      selectedWork,
      profileTagPreview: parseTags(profile.tags),
      selectedWorkTagPreview: parseTags(selectedWork && selectedWork.tagsText),
      selectedIsPinned: Boolean(selectedWork && this.data.pinnedDraft.includes(selectedWork.id)),
      serviceEditors: this.data.serviceDrafts.map((service) => ({
        id: service.id, name: service.name, price: service.price, unit: service.unit, description: service.description,
        serviceMode: service.serviceMode,
        serviceModeIndex: Math.max(0, SERVICE_MODES.findIndex((item) => item.value === service.serviceMode)),
        serviceModeLabel: (SERVICE_MODES.find((item) => item.value === service.serviceMode) || SERVICE_MODES[0]).label,
        serviceAreas: service.serviceAreas || [],
        workCount: (service.workIds || []).length,
        expanded: this.data.serviceExpandedIds.includes(service.id)
      })),
      workEditors: this.data.workDrafts.map((work) => ({
        id: work.id, title: work.title, code: work.code, tone: work.tone, referenceCount: work.referenceCount,
        coverImage: (work.imagePreviews || [])[0] || "", pinned: this.data.pinnedDraft.includes(work.id),
        tags: parseTags(work.tagsText).slice(0, 2), price: work.price
      })),
      canPublish: canPublish(profile, this.data.serviceDrafts, this.data.workDrafts),
      canSaveWork: canSaveWork(selectedWork),
      hasPendingMedia: this.data.workDrafts.some((work) => (work.mediaStatuses || []).includes("PENDING_SECURITY_REVIEW")),
      hasRejectedMedia: this.data.workDrafts.some((work) => (work.mediaStatuses || []).includes("REJECTED"))
    });
  },

  updateProfile(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "nickname") return;
    const value = event.detail.value;
    const profileDraft = Object.assign({}, this.data.profileDraft, { [key]: value });
    const patch = { [`profileDraft.${key}`]: value, canPublish: canPublish(profileDraft, this.data.serviceDrafts, this.data.workDrafts) };
    if (key === "tags") patch.profileTagPreview = parseTags(value);
    this.setData(patch);
  },

  updateProfileRegion(event) {
    const region = pickerRegion(event.detail);
    if (!region) return wx.showToast({ title: "城市信息读取失败，请重试", icon: "none" });
    const profileDraft = Object.assign({}, this.data.profileDraft, { city: region.cityName, cityCode: region.cityCode });
    this.setData({ profileDraft, canPublish: canPublish(profileDraft, this.data.serviceDrafts, this.data.workDrafts) });
  },

  updateCareer(event) {
    const career = CAREERS[Number(event.detail.value)] || "";
    const profileDraft = Object.assign({}, this.data.profileDraft, { career });
    this.setData({ career, profileDraft, canPublish: canPublish(profileDraft, this.data.serviceDrafts, this.data.workDrafts) });
  },

  updateService(event) {
    const index = Number(event.currentTarget.dataset.index);
    const key = event.currentTarget.dataset.key;
    const value = key === "price" ? sanitizeYuanInput(event.detail.value) : event.detail.value;
    const serviceDrafts = this.data.serviceDrafts.map((service, itemIndex) =>
      itemIndex === index ? Object.assign({}, service, { [key]: value }) : service
    );
    const patch = {
      [`serviceDrafts[${index}].${key}`]: value,
      canPublish: canPublish(this.data.profileDraft, serviceDrafts, this.data.workDrafts)
    };
    patch[`serviceEditors[${index}].${key}`] = value;
    this.setData(patch);
  },

  updateServiceMode(event) {
    const index = Number(event.currentTarget.dataset.index);
    const mode = SERVICE_MODES[Number(event.detail.value)] || SERVICE_MODES[0];
    const serviceDrafts = this.data.serviceDrafts.map((service, itemIndex) => itemIndex === index ? Object.assign({}, service, { serviceMode: mode.value }) : service);
    this.setData({ serviceDrafts }, () => this.refreshDerived());
  },

  addServiceArea(event) {
    const index = Number(event.currentTarget.dataset.index);
    const region = pickerRegion(event.detail);
    const service = this.data.serviceDrafts[index];
    if (!region || !service) return wx.showToast({ title: "服务城市读取失败，请重试", icon: "none" });
    const areas = (service.serviceAreas || []).filter((item) => item.cityCode !== region.cityCode).concat({ cityName: region.cityName, cityCode: region.cityCode });
    const serviceDrafts = this.data.serviceDrafts.map((item, itemIndex) => itemIndex === index ? Object.assign({}, item, { serviceAreas: areas }) : item);
    this.setData({ serviceDrafts }, () => this.refreshDerived());
  },

  removeServiceArea(event) {
    const index = Number(event.currentTarget.dataset.index);
    const cityCode = String(event.currentTarget.dataset.cityCode || "");
    const serviceDrafts = this.data.serviceDrafts.map((service, itemIndex) => itemIndex === index
      ? Object.assign({}, service, { serviceAreas: (service.serviceAreas || []).filter((area) => area.cityCode !== cityCode) })
      : service);
    this.setData({ serviceDrafts }, () => this.refreshDerived());
  },

  updateServiceWorks(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.applyServiceWorks(index, event.detail.value);
  },

  applyServiceWorks(index, selected, callback) {
    const newlyLinked = selected.filter((id) => !(this.data.serviceDrafts[index].workIds || []).includes(id));
    const drafts = this.data.serviceDrafts.map((service, serviceIndex) => {
      if (serviceIndex === index) return Object.assign({}, service, { workIds: selected });
      return newlyLinked.length ? Object.assign({}, service, {
        workIds: (service.workIds || []).filter((id) => !newlyLinked.includes(id))
      }) : service;
    });
    this.setData({ serviceDrafts: drafts }, () => {
      this.refreshDerived();
      if (callback) callback();
    });
  },

  toggleServiceEditor(event) {
    const id = event.currentTarget.dataset.id;
    const expanded = this.data.serviceExpandedIds;
    this.setData({ serviceExpandedIds: expanded.includes(id) ? expanded.filter((item) => item !== id) : expanded.concat(id) }, () => this.refreshDerived());
  },

  openWorkPicker(event) {
    const index = Number(event.currentTarget.dataset.index);
    const service = this.data.serviceDrafts[index];
    if (!service) return;
    const selected = (service.workIds || []).slice();
    this.setData({
      workPickerOpen: true,
      workPickerServiceIndex: index,
      workPickerDraftIds: selected,
      workPickerOptions: this.data.workDrafts.map((work) => ({
        id: work.id, title: work.title, code: work.code, tone: work.tone,
        coverImage: (work.imagePreviews || [])[0] || "", checked: selected.includes(work.id)
      }))
    });
  },

  closeWorkPicker() {
    this.setData({ workPickerOpen: false, workPickerServiceIndex: -1, workPickerDraftIds: [], workPickerOptions: [] });
  },

  noop() {},

  toggleWorkPickerWork(event) {
    const id = event.currentTarget.dataset.id;
    const selected = this.data.workPickerDraftIds;
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : selected.concat(id);
    this.setData({
      workPickerDraftIds: next,
      workPickerOptions: this.data.workPickerOptions.map((work) => Object.assign({}, work, { checked: next.includes(work.id) }))
    });
  },

  confirmWorkPicker() {
    const index = this.data.workPickerServiceIndex;
    if (!Number.isInteger(index) || index < 0) return this.closeWorkPicker();
    this.applyServiceWorks(index, this.data.workPickerDraftIds.slice(), () => this.closeWorkPicker());
  },

  addService() {
    const service = { id: `service-${Date.now()}`, name: "", price: 0, unit: "次", description: "", serviceMode: "ONSITE", serviceAreas: [], workIds: [] };
    this.setData({ serviceDrafts: this.data.serviceDrafts.concat(service), serviceExpandedIds: this.data.serviceExpandedIds.concat(service.id) }, () => this.refreshDerived());
  },

  deleteService(event) {
    const index = Number(event.currentTarget.dataset.index);
    const removed = this.data.serviceDrafts[index];
    this.setData({
      serviceDrafts: this.data.serviceDrafts.filter((_, itemIndex) => itemIndex !== index),
      serviceExpandedIds: removed ? this.data.serviceExpandedIds.filter((id) => id !== removed.id) : this.data.serviceExpandedIds
    }, () => this.refreshDerived());
  },

  openWorkEditor(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/provider-profile/index?edit=1&section=works&workId=${id}${this.auditMode ? "&audit=1" : ""}` });
  },

  openNewWorkEditor() {
    wx.navigateTo({ url: `/pages/provider-profile/index?edit=1&section=works${this.auditMode ? "&audit=1" : ""}` });
  },

  updateWork(event) {
    const key = event.currentTarget.dataset.key;
    let value = event.detail.value;
    if (key === "price") value = sanitizeYuanInput(value);
    const index = this.data.selectedWorkIndex;
    const workDrafts = this.data.workDrafts.map((work, itemIndex) =>
      itemIndex === index ? Object.assign({}, work, { [key]: value }) : work
    );
    const patch = {
      [`workDrafts[${index}].${key}`]: value,
      [`selectedWork.${key}`]: value,
      canPublish: canPublish(this.data.profileDraft, this.data.serviceDrafts, workDrafts),
      canSaveWork: canSaveWork(workDrafts[index])
    };
    if (key === "title") patch[`workEditors[${index}].title`] = value;
    if (key === "tagsText") patch.selectedWorkTagPreview = parseTags(value);
    this.setData(patch);
  },

  togglePortfolioPin(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const pinned = this.data.pinnedDraft;
    if (!pinned.includes(id) && pinned.length >= 2) {
      wx.showToast({ title: "最多置顶 2 件作品，请先取消一件", icon: "none" });
      return;
    }
    this.setData({ pinnedDraft: pinned.includes(id) ? pinned.filter((item) => item !== id) : pinned.concat(id) }, () => this.refreshDerived());
  },

  saveSelectedFile(file, prefix) {
    if (this.data.remoteEnabled) {
      return cloudCatalog.uploadImage(file, prefix === "notice" ? "NOTICE_IMAGE" : "WORK_IMAGE").then((uploaded) => {
        this.pendingCloudAssets.push(uploaded);
        return uploaded;
      });
    }
    if (file.size && file.size > 20 * 1024 * 1024) return Promise.reject(new Error("图片不能超过 20MB"));
    return new Promise((resolve, reject) => {
      wx.saveFile({
        tempFilePath: file.tempFilePath,
        success: ({ savedFilePath }) => {
          this.pendingSavedFiles.push(savedFilePath);
          resolve(savedFilePath);
        },
        fail: reject
      });
    });
  },

  async consumeEntryUpload() {
    const tempFiles = pendingWorkUpload.consume();
    if (!tempFiles.length) return;
    const currentIndex = this.data.selectedWorkIndex;
    const selected = this.data.workDrafts[currentIndex];
    wx.showLoading({ title: "正在载入作品" });
    try {
      const saved = await Promise.all(tempFiles.map((file, index) =>
        this.saveSelectedFile(file, `work-${selected.id}-${index}`)
      ));
      const previews = saved.map((item) => typeof item === "string" ? item : item.preview);
      const assetIds = saved.filter((item) => typeof item !== "string").map((item) => item.assetId);
      const statuses = saved.filter((item) => typeof item !== "string").map((item) => item.status);
      const workDrafts = this.data.workDrafts.map((work, index) => index === currentIndex
        ? Object.assign({}, work, { imagePreviews: previews, imageAssetIds: assetIds, mediaStatuses: statuses, imageCount: previews.length }) : work);
      this.setData({ workDrafts }, () => this.refreshDerived());
    } catch (error) {
      wx.showToast({ title: error.message || "图片载入失败，请重新选择", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  removePendingFile(filePath) {
    const cloudAsset = this.pendingCloudAssets.find((item) => item.preview === filePath);
    if (cloudAsset) {
      this.pendingCloudAssets = this.pendingCloudAssets.filter((item) => item.assetId !== cloudAsset.assetId);
      cloudCatalog.cancelImage(cloudAsset.assetId, cloudAsset.fileId).catch(() => {});
      return;
    }
    if (!this.pendingSavedFiles.includes(filePath)) return;
    this.pendingSavedFiles = this.pendingSavedFiles.filter((item) => item !== filePath);
    wx.removeSavedFile({ filePath, fail: () => {} });
  },

  clearPendingFiles() {
    const assets = this.pendingCloudAssets.slice();
    this.pendingCloudAssets = [];
    assets.forEach((item) => cloudCatalog.cancelImage(item.assetId, item.fileId).catch(() => {}));
    const paths = this.pendingSavedFiles.slice();
    this.pendingSavedFiles = [];
    paths.forEach((filePath) => wx.removeSavedFile({ filePath, fail: () => {} }));
  },

  chooseNoticeImage() {
    wx.chooseMedia({ count: 1, mediaType: ["image"], sizeType: ["compressed"], success: async ({ tempFiles }) => {
      if (!tempFiles[0]) return;
      wx.showLoading({ title: "正在保存图片" });
      try {
        const previous = this.data.noticeImageDraft;
        const uploaded = await this.saveSelectedFile(tempFiles[0], "notice");
        const image = typeof uploaded === "string" ? uploaded : uploaded.preview;
        this.removePendingFile(previous);
        this.setData({ noticeImageDraft: image, noticeImageAssetId: typeof uploaded === "string" ? this.data.noticeImageAssetId : uploaded.assetId });
      } catch (error) {
        wx.showToast({ title: error.message || "图片保存失败", icon: "none" });
      } finally {
        wx.hideLoading();
      }
    } });
  },

  chooseWorkImages() {
    const current = this.data.workDrafts[this.data.selectedWorkIndex];
    const remaining = Math.max(0, 5 - (current.imagePreviews || []).length);
    if (!remaining) {
      wx.showToast({ title: "每件作品最多 5 张图片", icon: "none" });
      return;
    }
    chooseWorkMedia({ count: remaining, success: async ({ tempFiles }) => {
      const currentIndex = this.data.selectedWorkIndex;
      const selected = this.data.workDrafts[currentIndex];
      wx.showLoading({ title: "正在保存图片" });
      try {
        const saved = await Promise.all(tempFiles.slice(0, remaining).map((file, index) =>
          this.saveSelectedFile(file, `work-${selected.id}-${index}`)
        ));
        const images = [...(selected.imagePreviews || []), ...saved.map((item) => typeof item === "string" ? item : item.preview)].slice(0, 5);
        const assetIds = [...(selected.imageAssetIds || []), ...saved.filter((item) => typeof item !== "string").map((item) => item.assetId)].slice(0, 5);
        const statuses = [...(selected.mediaStatuses || []), ...saved.filter((item) => typeof item !== "string").map((item) => item.status)].slice(0, 5);
        const workDrafts = this.data.workDrafts.map((work, index) => index === currentIndex
          ? Object.assign({}, work, { imagePreviews: images, imageAssetIds: assetIds, mediaStatuses: statuses, imageCount: images.length }) : work);
        this.setData({ workDrafts }, () => this.refreshDerived());
      } catch (error) {
        wx.showToast({ title: error.message || "图片保存失败", icon: "none" });
      } finally {
        wx.hideLoading();
      }
    } });
  },

  removeWorkImage(event) {
    const imageIndex = Number(event.currentTarget.dataset.index);
    const workIndex = this.data.selectedWorkIndex;
    const selected = this.data.workDrafts[workIndex];
    if (!selected || !Number.isInteger(imageIndex)) return;
    const removedPath = (selected.imagePreviews || [])[imageIndex];
    this.removePendingFile(removedPath);
    const imagePreviews = (selected.imagePreviews || []).filter((_, index) => index !== imageIndex);
    const imageAssetIds = (selected.imageAssetIds || []).filter((_, index) => index !== imageIndex);
    const mediaStatuses = (selected.mediaStatuses || []).filter((_, index) => index !== imageIndex);
    const workDrafts = this.data.workDrafts.map((work, index) => index === workIndex
      ? Object.assign({}, work, { imagePreviews, imageAssetIds, mediaStatuses, imageCount: imagePreviews.length }) : work);
    this.setData({ workDrafts }, () => this.refreshDerived());
  },

  cancelEdit() {
    this.clearPendingFiles();
    storefrontPreviewDraft.clear();
    if (this.data.editorSection === "works") {
      this.setData({ editing: false });
      wx.navigateBack({ fail: () => wx.redirectTo({ url: `/pages/provider-profile/index?edit=1&section=profile${this.auditMode ? "&audit=1" : ""}` }) });
      return;
    }
    this.setData({ editing: false });
    wx.navigateBack({ delta: 1, fail: () => {
      wx.setStorageSync("animeMasterRole", "provider");
      wx.switchTab({ url: "/pages/discover/index" });
    } });
  },

  onUnload() {
    if (storefrontPreviewDraft.isPublished()) {
      this.pendingSavedFiles = [];
      storefrontPreviewDraft.clear();
      return;
    }
    if (this.data.editing) this.clearPendingFiles();
    storefrontPreviewDraft.clear();
  },

  buildDraftValue() {
    const first = this.data.serviceDrafts[0] || {};
    const profile = Object.assign({}, this.data.profileDraft, {
      serviceName: first.name || "",
      servicePrice: first.price || 0,
      serviceDescription: first.description || ""
    });
    const works = this.data.workDrafts.map(({ tagsText, ...work }) => Object.assign({}, work, {
      tags: parseTags(tagsText == null ? (work.tags || []).join(",") : tagsText)
    }));
    return {
      career: this.data.career,
      profile,
      services: this.data.serviceDrafts,
      works,
      pinnedWorkIds: this.data.pinnedDraft,
      noticeImageAssetId: this.data.noticeImageAssetId,
      noticeImage: this.data.noticeImageDraft
    };
  },

  openDraftPreview(draft, draftVersion) {
    const providerId = this.serverProviderId || store.CURRENT_PROVIDER_ID;
    storefrontPreviewDraft.stage({
      providerId,
      profile: draft.profile,
      services: draft.services,
      works: draft.works,
      pinnedWorkIds: draft.pinnedWorkIds,
      noticeImage: draft.noticeImage,
      draftVersion
    });
    this.previewOpen = true;
    wx.navigateTo({
      url: `/pages/provider-detail/index?id=${providerId}&workspace=provider&preview=storefront${this.auditMode ? "&audit=1" : ""}`,
      success: () => this.setData({ saving: false }),
      fail: () => {
        this.previewOpen = false;
        storefrontPreviewDraft.clear();
        this.setData({ saving: false });
        wx.showToast({ title: "预览打开失败，本次修改已保留", icon: "none" });
      }
    });
  },

  saveCloudAndPreview(draft) {
    cloudCatalog.saveDraft(this.data.remoteDraftVersion, draft).then((saved) => {
      this.pendingCloudAssets = [];
      this.setData({ remoteDraftVersion: saved.version });
      this.openDraftPreview(draft, saved.version);
    }).catch((error) => {
      this.setData({ saving: false });
      wx.showToast({ title: error.code === "VERSION_CONFLICT" ? "草稿已更新，请重新加载" : "云端草稿保存失败，请重试", icon: "none" });
    });
  },

  saveAndPreview() {
    if (!this.data.canPublish) return wx.showToast({ title: "请先设置昵称、职业和常驻城市，并完成服务、作品和图片必填信息", icon: "none" });
    if (this.data.saving) return;
    this.setData({ saving: true });
    const draft = this.buildDraftValue();
    if (this.data.remoteEnabled) return this.saveCloudAndPreview(draft);
    this.openDraftPreview(draft, null);
  },

  saveWork() {
    const selected = this.data.workDrafts[this.data.selectedWorkIndex];
    if (!canSaveWork(selected)) {
      wx.showToast({ title: "请上传图片并完成作品必填信息", icon: "none" });
      return;
    }
    const savedWork = Object.assign({}, selected, { tags: parseTags(selected.tagsText) });
    delete savedWork.tagsText;
    const publishedWorks = this.data.remoteEnabled ? this.data.works : store.getWorks();
    const existingIndex = publishedWorks.findIndex((work) => work.id === savedWork.id);
    const nextWorks = existingIndex >= 0
      ? publishedWorks.map((work, index) => index === existingIndex ? savedWork : work)
      : publishedWorks.concat(savedWork);
    if (this.data.remoteEnabled) {
      const draft = this.buildDraftValue();
      draft.works = nextWorks;
      cloudCatalog.saveDraft(this.data.remoteDraftVersion, draft).then((saved) => {
        this.pendingCloudAssets = [];
        this.setData({ editing: false, remoteDraftVersion: saved.version });
        wx.navigateBack({ fail: () => wx.redirectTo({ url: "/pages/provider-profile/index?edit=1&section=profile" }) });
      }).catch((error) => {
        wx.showToast({ title: error.code === "VERSION_CONFLICT" ? "草稿已更新，请重新加载" : "作品保存失败，请重试", icon: "none" });
      });
      return;
    }
    store.saveWorks(nextWorks);
    this.pendingSavedFiles = [];
    this.setData({ editing: false });
    wx.navigateBack({ fail: () => wx.redirectTo({ url: `/pages/provider-profile/index?edit=1&section=profile${this.auditMode ? "&audit=1" : ""}` }) });
  },

  previewBuyer() {
    wx.navigateTo({ url: `/pages/provider-detail/index?id=${this.serverProviderId || store.CURRENT_PROVIDER_ID}&workspace=provider${this.auditMode ? "&audit=1" : ""}` });
  },

  previewSelectedWork() {
    if (!this.data.selectedWork) return;
    const published = (this.data.remoteEnabled ? this.data.works : store.getWorks()).some((work) => work.id === this.data.selectedWork.id);
    if (!published) return wx.showToast({ title: "请先保存发布新作品", icon: "none" });
    wx.navigateTo({ url: `/pages/work-detail/index?id=${this.data.selectedWork.id}&workspace=provider${this.auditMode ? "&audit=1" : ""}` });
  }
});
