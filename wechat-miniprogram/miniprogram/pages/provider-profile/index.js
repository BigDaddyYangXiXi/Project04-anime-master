const bannerCrop = require('../../utils/banner-crop');
const storefrontChanges = require('../../data/storefront-changes');
const workImageEdit = require("../../utils/work-image-edit");
const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const { providers } = require("../../data/v063");
const pendingWorkUpload = require("../../data/pending-work-upload");
const storefrontPreviewDraft = require("../../data/storefront-preview-draft");
const { chooseWorkMedia, chooseImageMedia } = require("../../utils/work-media-picker");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudAccount = require("../../services/cloud-account");
const cloudAvailability = require("../../services/cloud-availability");
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
function publicationReadiness(profile, services, works) {
  const issues = [];
  if (!profile || !profile.nickname || !profile.nickname.trim()) issues.push({ key: 'nickname', type: 'account', label: '设置账号昵称' });
  const profileMissing = [];
  if (!profile || !CAREERS.includes(profile.career)) profileMissing.push('服务职业');
  if (!profile || !/^\d{6}$/.test(profile.cityCode || '')) profileMissing.push('常驻城市');
  if (profileMissing.length) issues.push({ key: 'profile', type: 'profile', label: '完善基本资料：' + profileMissing.join('、') });
  const profileReady = !issues.length;
  if (!services.length) issues.push({ key: 'new-service', type: 'new-service', label: '添加一项服务，说明价格与服务内容' });
  const servicesReady = services.length > 0 && services.map((service, index) => {
    const missing = [];
    if (!service.name.trim()) missing.push('名称');
    if (!service.description.trim()) missing.push('描述');
    if (!service.unit.trim()) missing.push('单位');
    if (!(Number(service.price) > 0)) missing.push('有效价格');
    if (!SERVICE_MODES.some(item => item.value === service.serviceMode)) missing.push('服务方式');
    if (missing.length) issues.push({ key: 'service-' + service.id, type: 'service', id: service.id, label: (service.name || '服务 ' + (index + 1)) + '：补充' + missing.join('、') });
    return !missing.length;
  }).every(Boolean);
  const worksReady = works.map((work, index) => {
    const missing = [];
    if (!work.title.trim()) missing.push('标题');
    if (!work.description.trim()) missing.push('描述');
    if (work.price != null && work.price !== '' && !(Number(work.price) > 0)) missing.push('有效参考价或留空');
    if (!((work.imageAssetIds || []).length || (work.imagePreviews || []).length || Number(work.imageCount) > 0)) missing.push('图片');
    if (missing.length) issues.push({ key: 'work-' + work.id, type: 'work', id: work.id, label: (work.title || '作品 ' + (index + 1)) + '：补充' + missing.join('、') });
    return !missing.length;
  }).every(Boolean);
  return { profileReady, servicesReady, worksReady, ready: profileReady && servicesReady && worksReady, issues };
}
function canPublish(profile, services, works) { return publicationReadiness(profile, services, works).ready; }
function canSaveWork(work) {
  return Boolean(work && work.id);
}
function createWorkDraft() {
  const timestamp = Date.now();
  const stamp = timestamp.toString(36).toUpperCase().slice(-5);
  return {
    id: `work-${timestamp}`, code: `AM-MU-${stamp}`, title: "", subtitle: "", tone: "coral",
    price: "", description: "", tags: [], tagsText: "", referenceCount: 0,
    imageCount: 0, imagePreviews: []
  };
}

Page({
  data: {
    serviceDetailsOpen: false, workCreditsOpen: false, sectionSaveComplete: false, savedSectionTitle: "草稿已保存", workServicePickerOpen: false, workServiceDraftIndex: 0, textEditor: null, textEditorHeight: 280, keyboardInset: 0, managementTab: "", editorView: "manage", profileTab: "works", editorError: "", activeServiceIndex: -1,
    pendingImagePreviews: [], selectedImageIndex: 0, dragImageIndex: null, dragTargetIndex: null, mediaReviewMessage: '',
    imageSettings: null, watermarkPositions: ['右下角','左下角','右上角','左上角','居中'], watermarkPositionIndex: 0,
    imagesEditorOpen: false, bannerEditorOpen: false, imageToolsIndex: -1, profilePreferencesOpen: false,
    publicationStatusLabel: "", publicationStatusHint: "", reviewChanges: [], reviewLoading: false, reviewError: "", reviewKnown: false, activePublication: false,
    editing: false, career: "", accountNickname: "", profile: null, profileDraft: null, editorSection: "all", navTitle: "编辑服务橱窗",
    services: [], serviceDrafts: [], serviceEditors: [], works: [], workDrafts: [], workEditors: [],
    pinnedWorkIds: [], pinnedDraft: [], selectedWorkIndex: 0, selectedWork: null,
    noticeImage: "", noticeImageDraft: "", noticeImageAssetId: null, selectedIsPinned: false, canPublish: false, canSaveWork: false, isNewWork: false, saving: false, uploadingImages: false, workSaveComplete: false,
    cloudLoading: false, cloudError: "", refreshError: "", remoteEnabled: false, remoteDraftVersion: 0, hasPendingMedia: false, hasRejectedMedia: false,
    workPickerOpen: false, workPickerServiceIndex: -1, workPickerDraftIds: [], workPickerOptions: [],
    profileTagPreview: [], selectedWorkTagPreview: [], serviceModeOptions: SERVICE_MODES.map((item) => item.label), careerOptions: CAREERS
  },

  onLoad(options = {}) {
    this.unloaded = false;
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : null;
    this.keyboardWindowHeight = windowInfo && windowInfo.windowHeight;
    this.pendingSavedFiles = [];
    this.pendingCloudAssets = [];
    this.requestSection = options.section || "";
    this.requestWorkId = options.workId || "";
    this.setData({
      managerBackLabel: options.from === "workbench" ? "返回工作台" : "返回上一页",
      editorSection: this.requestSection === "works" ? "works" : this.requestSection === "profile" ? "profile" : "all",
      navTitle: this.requestSection === "works" ? (this.requestWorkId ? "编辑作品" : "上传作品") : "管理橱窗"
    });
    this.auditInvalid = localPreview.isAudit(options) && options.invalid === "1";
    this.auditTwoWorks = localPreview.isAudit(options) && options.twoWorks === "1";
    this.auditMode = localPreview.isAudit(options);
  },

  onPageScroll(event) { this.editorScrollTop = event.scrollTop; },

  onHide() { if (this.mediaReviewTimer) clearTimeout(this.mediaReviewTimer); this.editorHidden = true; this.cancelImageDrag(); this.keyboardSequence = (this.keyboardSequence || 0) + 1; this.activeKeyboardField = null; this.setData({ keyboardInset: 0 }); },

  onShow() {
    this.editorHidden = false;
    this.scheduleMediaReview(0);
    if (this.previewOpen) {
      this.previewOpen = false;
      this.setData({ saving: false });
      if (this.publicationProgressOpen) {
        this.publicationProgressOpen=false;cloudCatalog.clearStorefrontState();
        if(!this.auditMode)this.loadCloudEditor();
      }
      if (storefrontPreviewDraft.consumePublished()) {
        this.pendingSavedFiles = [];
        this.pendingCloudAssets = [];
        this.setData({ editing: false });
        if (!this.auditMode) this.loadCloudEditor();
        else this.openEditor();
      }
      return;
    }
    if (this.accountOpen) {
      this.accountOpen = false;
      const providerId = this.serverProviderId;
      const readSequence = this.editorReadSequence = (this.editorReadSequence || 0) + 1;
      const current = () => !this.unloaded && readSequence === this.editorReadSequence && providerId === this.serverProviderId;
      const update = account => {
        if (!current() || !this.auditMode && account.id !== providerId) return;
        this.setData({ accountNickname: account.nickname || "", "profileDraft.nickname": account.nickname || "", "profileDraft.avatar": account.avatarUrl || account.avatar || "", "profileDraft.uid": account.uid || "", "profileDraft.username": account.username || "" });
        if (this.savedDraft) Object.assign(this.savedDraft.profile, { nickname: account.nickname || '', avatar: account.avatarUrl || account.avatar || '', uid: account.uid || '', username: account.username || '' });
        this.refreshDerived();
      };
      if (this.auditMode) update(store.getAccount("provider"));
      else cloudAccount.getMine().then(update).catch(() => {
        if (current()) this.setData({ editorError: "账号资料回读失败，请重新进入资料编辑。" });
      });
      return;
    }
    if (!this.auditMode) {
      this.loadCloudEditor();
      return;
    }
    if (this.data.editing) {
      if (this.data.editorSection !== "works") {
        const saved = wx.getStorageSync("animeMasterCreatorAuditDraft");
        const works = saved ? saved.works : store.getWorks();
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
    if (this.unloaded || this.data.cloudLoading || this.data.saving || this.data.uploadingImages) return;
    const readSequence = this.editorReadSequence = (this.editorReadSequence || 0) + 1;
    const expectedVersion = this.data.remoteDraftVersion;
    const cachedDraft = cloudCatalog.peekDraft();
    this.setData({ cloudLoading: !cachedDraft, cloudError: "", refreshError: "", remoteEnabled: true });
    const applyDraft = ({ version, clientDraft, providerId, contentIntent }) => {
      if (this.unloaded || readSequence !== this.editorReadSequence) return;
      if (this.data.saving || this.data.remoteDraftVersion !== expectedVersion) { this.setData({ cloudLoading: false }); return; }
      const preserveDraft = this.data.editing && this.serverProviderId === providerId && this.data.remoteDraftVersion === version;
      this.serverProviderId = providerId;
      this.savedDraft = clone(clientDraft);
      this.updatePublicationSummary(contentIntent);
      if (!cachedDraft) cloudCatalog.getProvider(providerId, { images: false }).then(({ provider }) => {
        if (this.unloaded || readSequence !== this.editorReadSequence) return;
        this.publicStatistics = provider || {};
        this.setData({ hasPublicVersion: !!provider });
        this.refreshDerived();
      }).catch(() => {});
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
      }, () => { if (preserveDraft) this.refreshDerived(); else this.beginEdit(); this.scheduleMediaReview(0); });
    };
    const onError = (error) => {
      if (this.unloaded || readSequence !== this.editorReadSequence) return;
      if (this.data.saving || this.data.remoteDraftVersion !== expectedVersion) { this.setData({ cloudLoading: false }); return; }
      if (this.data.profile && !error.code) {
        this.setData({ cloudLoading: false, refreshError: "刷新失败，当前修改已保留，可稍后重试。" });
        return;
      }
      this.setData({ cloudLoading: false, cloudError: error.code === "VERSION_CONFLICT" ? "草稿已更新，请重新加载" : "云端橱窗载入失败，请重试" });
    };
    if (cachedDraft) applyDraft(cachedDraft);
    else cloudCatalog.getDraft().then(applyDraft).catch(onError);
  },

  retryCloudLoad() {
    cloudCatalog.clearStorefrontState();
    this.loadCloudEditor();
  },

  openEditor() {
    this.loadPublished();
    this.setData({ saving: false });
    this.beginEdit();
    this.savedDraft = clone(this.buildDraftValue());
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
    this.publicStatistics = Object.assign({}, provider, { reviewCount: store.getOrders().filter((order) => order.providerId === provider.id && order.stage === "COMPLETED" && order.rating > 0).length });
    this.setData({
      career: provider.career,
      accountNickname: store.getAccount("provider").nickname || "",
      profile: store.getProfile(),
      services: normalizeServices(store.getServices()),
      works: store.getWorks(),
      pinnedWorkIds: store.getPinnedWorkIds(),
      noticeImage: store.getNoticeImage()
    });
    const saved = wx.getStorageSync("animeMasterCreatorAuditDraft");
    if (saved) this.setData({ career: saved.career, profile: saved.profile, services: normalizeServices(saved.services), works: saved.works, pinnedWorkIds: saved.pinnedWorkIds, noticeImage: saved.noticeImage });
  },

  beginEdit() {
    const workDrafts = normalizeWorks(clone(this.data.works));
    if (this.data.editorSection === "works") {
      const requestedIndex = workDrafts.findIndex((work) => work.id === this.requestWorkId);
      if (this.requestWorkId && requestedIndex < 0) {
        this.setData({ editing: false, workSaveComplete: false, selectedWork: null, selectedWorkIndex: -1,
          workDrafts: [], isNewWork: false, canSaveWork: false,
          cloudError: "这件作品已不在当前橱窗草稿中，请返回作品列表重新选择，或重新加载核对。" });
        return;
      }
      const isNewWork = !this.requestWorkId;
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
      pinnedDraft: clone(this.data.pinnedWorkIds).slice(0, 2),
      noticeImageDraft: this.data.noticeImage,
      selectedWorkIndex: 0,
      selectedWork: workDrafts[0] || null
    }, () => { this.refreshDerived(); this.workEditSnapshot = clone(this.buildDraftValue()); });
  },

  refreshDerived() {
    const profile = this.data.profileDraft || {};
    const selectedWork = this.data.workDrafts[this.data.selectedWorkIndex] || null;
    const selectedWorkService = this.data.serviceDrafts.find((service) => selectedWork && (service.workIds || []).includes(selectedWork.id)) || null;
    const workServiceOptions = [{ id: '', label: '暂不关联' }, ...this.data.serviceDrafts.map((service, index) => ({ id: service.id, label: service.name || `未命名服务 ${index + 1}`, priceText: service.price === '' || service.price == null ? '报价待填写' : `￥${service.price} / ${service.unit || '单位待填写'}` }))];
    this.setData({
      selectedWork,
      selectedImageIndex: Math.min(this.data.selectedImageIndex || 0, Math.max(0, (selectedWork?.imagePreviews || []).length - 1)),
      coverPreviewWork: selectedWork ? { ...selectedWork, provider: { name: profile.nickname || "", avatar: profile.avatar || "" } } : null,
      workImageSlots: selectedWork ? (selectedWork.imagePreviews || []).map((preview, index) => ({
        id: (selectedWork.imageAssetIds || [])[index] || `${selectedWork.id}:${index}`,
        preview, status: (selectedWork.mediaStatuses || [])[index]
      })) : [],
      selectedWorkService,
      workServiceOptions,
      workServiceIndex: selectedWorkService ? workServiceOptions.findIndex(option => option.id === selectedWorkService.id) : 0,
      profileTagPreview: parseTags(profile.tags),
      selectedWorkTagPreview: parseTags(selectedWork && selectedWork.tagsText),
      selectedIsPinned: Boolean(selectedWork && this.data.pinnedDraft.includes(selectedWork.id)),
      serviceEditors: this.data.serviceDrafts.map((service) => ({
        id: service.id, name: service.name, price: service.price, unit: service.unit, description: service.description,
        includes: service.includes || "", extras: service.extras || "", preparation: service.preparation || "",
        serviceMode: service.serviceMode,
        serviceModeIndex: Math.max(0, SERVICE_MODES.findIndex((item) => item.value === service.serviceMode)),
        serviceModeLabel: (SERVICE_MODES.find((item) => item.value === service.serviceMode) || SERVICE_MODES[0]).label,
        serviceAreas: service.serviceAreas || [],
        serviceCitiesText: (service.serviceAreas || []).map(area => area.cityName).join("、") || this.data.profileDraft.city || "地区待填写",
        workCount: (service.workIds || []).length,
        linkedTitles: this.data.workDrafts.filter((work) => (service.workIds || []).includes(work.id)).map((work) => work.title).join("、")
      })),
      workEditors: this.data.workDrafts.map((work) => ({
        id: work.id, title: work.title, code: work.code, tone: work.tone, referenceCount: work.referenceCount,
        serviceName: (this.data.serviceDrafts.find(service => (service.workIds || []).includes(work.id)) || {}).name || '',
        coverImage: (work.imagePreviews || [])[0] || "", pinned: this.data.pinnedDraft.includes(work.id),
        tags: parseTags(work.tagsText).slice(0, 2), price: work.price,
        ...this.portfolioWorkState(work)
      })).sort((a,b) => Number(b.pinned) - Number(a.pinned)),
      publicationReadiness: publicationReadiness(profile, this.data.serviceDrafts, this.data.workDrafts),
      canPublish: canPublish(profile, this.data.serviceDrafts, this.data.workDrafts),
      canSaveWork: canSaveWork(selectedWork),
      hasPendingMedia: this.data.workDrafts.some((work) => (work.mediaStatuses || []).includes("PENDING_SECURITY_REVIEW")),
      hasRejectedMedia: this.data.workDrafts.some((work) => (work.mediaStatuses || []).includes("REJECTED"))
    });
  },

  updateProfile(event) {
    if (this.unloaded || this.data.saving) return;
    const key = event.currentTarget.dataset.key;
    if (key === "nickname") return;
    const value = event.detail.value;
    const profileDraft = Object.assign({}, this.data.profileDraft, { [key]: value });
    const patch = { [`profileDraft.${key}`]: value, canPublish: canPublish(profileDraft, this.data.serviceDrafts, this.data.workDrafts) };
    if (key === "tags") patch.profileTagPreview = parseTags(value);
    this.setData(patch);
  },

  updateProfileRegion(event) {
    if (this.unloaded || this.data.saving) return;
    const region = pickerRegion(event.detail);
    if (!region) return wx.showToast({ title: "城市信息读取失败，请重试", icon: "none" });
    const profileDraft = Object.assign({}, this.data.profileDraft, { city: region.cityName, cityCode: region.cityCode, district: (event.detail.value || [])[2] || "" });
    this.setData({ profileDraft, canPublish: canPublish(profileDraft, this.data.serviceDrafts, this.data.workDrafts) });
  },

  updateCareer(event) {
    if (this.unloaded || this.data.saving) return;
    const career = CAREERS[Number(event.detail.value)] || "";
    const profileDraft = Object.assign({}, this.data.profileDraft, { career });
    this.setData({ career, profileDraft, canPublish: canPublish(profileDraft, this.data.serviceDrafts, this.data.workDrafts) });
  },

  updateService(event) {
    if (this.unloaded || this.data.saving) return;
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
    if (this.unloaded || this.data.saving) return;
    const index = Number(event.currentTarget.dataset.index);
    const mode = SERVICE_MODES[Number(event.detail.value)] || SERVICE_MODES[0];
    const serviceDrafts = this.data.serviceDrafts.map((service, itemIndex) => itemIndex === index ? Object.assign({}, service, { serviceMode: mode.value }) : service);
    this.setData({ serviceDrafts }, () => this.refreshDerived());
  },

  addServiceArea(event) {
    if (this.unloaded || this.data.saving) return;
    const index = Number(event.currentTarget.dataset.index);
    const region = pickerRegion(event.detail);
    const service = this.data.serviceDrafts[index];
    if (!region || !service) return wx.showToast({ title: "服务城市读取失败，请重试", icon: "none" });
    const areas = (service.serviceAreas || []).filter((item) => item.cityCode !== region.cityCode).concat({ cityName: region.cityName, cityCode: region.cityCode });
    const serviceDrafts = this.data.serviceDrafts.map((item, itemIndex) => itemIndex === index ? Object.assign({}, item, { serviceAreas: areas }) : item);
    this.setData({ serviceDrafts }, () => this.refreshDerived());
  },

  useResidentCity(event) {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    const index = Number(event.currentTarget.dataset.index), profile = this.data.profileDraft;
    const service = this.data.serviceDrafts[index];
    if (!service || service.serviceMode === "ONLINE") return;
    if (!profile.city || !/^\d{6}$/.test(profile.cityCode || "")) {
      this.setData({ editorError: "请先在个人资料中设置常驻城市。" });
      return;
    }
    const area = { cityName: profile.city, cityCode: profile.cityCode };
    const serviceAreas = (service.serviceAreas || []).filter(item => item.cityCode !== area.cityCode).concat(area);
    this.setData({ serviceDrafts: this.data.serviceDrafts.map((item, i) => i === index ? { ...item, serviceAreas } : item), editorError: "" }, () => this.refreshDerived());
  },

  removeServiceArea(event) {
    if (this.unloaded || this.data.saving) return;
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
    if (this.unloaded || this.data.saving) return;
    if (this.data.serviceDrafts.some((service, serviceIndex) => serviceIndex !== index && (service.workIds || []).some(id => selected.includes(id)))) {
      wx.showToast({ title: "作品已关联其他服务，请先在原服务中解除关联", icon: "none" });
      return;
    }
    const drafts = this.data.serviceDrafts.map((service, serviceIndex) => serviceIndex === index ? Object.assign({}, service, { workIds: selected }) : service);
    this.setData({ serviceDrafts: drafts }, () => {
      this.refreshDerived();
      if (callback) callback();
    });
  },

  toggleServiceEditor(event) {
    if (this.confirmPendingEdit(() => this.toggleServiceEditor(event))) return;
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    const id = event.currentTarget.dataset.id;
    const index = this.data.serviceDrafts.findIndex((service) => service.id === id);
    if (index < 0) return;
    this.sectionScrollTop = this.editorScrollTop || 0;
    this.editSnapshot = clone(this.buildDraftValue());
    this.setData({ editorView: "service", activeServiceIndex: index, editorError: "", navTitle: "编辑服务" }, () => { this.refreshDerived(); wx.pageScrollTo({ scrollTop: 0, duration: 0 }); });
  },

  openWorkPicker(event) {
    const index = Number(event.currentTarget.dataset.index);
    const service = this.data.serviceDrafts[index];
    if (!service) return;
    this.associationScrollTop = this.editorScrollTop || 0;
    const selected = (service.workIds || []).slice();
    this.setData({
      workPickerOpen: true,
      workPickerServiceIndex: index,
      workPickerDraftIds: selected,
      workPickerOptions: this.data.workDrafts.map((work) => ({
        id: work.id, title: work.title, code: work.code, tone: work.tone,
        occupied: this.data.serviceDrafts.some((item, serviceIndex) => serviceIndex !== index && (item.workIds || []).includes(work.id)),
        coverImage: (work.imagePreviews || [])[0] || "", checked: selected.includes(work.id)
      }))
    }, () => wx.pageScrollTo({ scrollTop: 0, duration: 0 }));
  },

  closeWorkPicker() {
    this.setData({ workPickerOpen: false, workPickerServiceIndex: -1, workPickerDraftIds: [], workPickerOptions: [] }, () => wx.pageScrollTo({ scrollTop: this.associationScrollTop || 0, duration: 0 }));
  },

  noop() {},

  toggleWorkPickerWork(event) {
    const id = event.currentTarget.dataset.id;
    if ((this.data.workPickerOptions.find(work => work.id === id) || {}).occupied) return;
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
    if (this.confirmPendingEdit(() => this.addService())) return;
    if (this.unloaded || this.data.saving || this.data.cloudLoading || this.data.uploadingImages) return;
    this.sectionScrollTop = this.editorScrollTop || 0;
    this.editSnapshot = clone(this.buildDraftValue());
    if (this.data.serviceDrafts.length >= 20) return wx.showToast({ title: "最多添加20项服务", icon: "none" });
    const service = { id: `service-${Date.now()}`, name: "", price: 0, unit: "次", description: "", serviceMode: "ONSITE", serviceAreas: [], workIds: [] };
    this.setData({ editorView: "service", activeServiceIndex: this.data.serviceDrafts.length, navTitle: "新增服务", editorError: "", serviceDrafts: this.data.serviceDrafts.concat(service) }, () => { this.refreshDerived(); wx.pageScrollTo({ scrollTop: 0, duration: 0 }); });
  },

  deleteService(event) {
    if (this.unloaded || this.data.saving) return;
    if (this.data.serviceDrafts.length <= 1) return wx.showToast({ title: "至少保留一项服务", icon: "none" });
    const service = this.data.serviceDrafts[Number(event.currentTarget.dataset.index)];
    if (!service) return;
    const version = this.data.remoteDraftVersion;
    wx.showModal({ title: "删除此服务？", content: "作品会保留，与此服务的关联会解除。", success: async ({ confirm }) => {
      if (!confirm || this.unloaded || this.data.saving) return;
      if (this.data.remoteDraftVersion !== version || this.data.serviceDrafts.find(item => item.id === service.id) !== service || this.data.serviceDrafts.length <= 1) {
        wx.showToast({ title: "服务已变化，请重新核对后删除", icon: "none" });
        return;
      }
      const previous = clone(this.data.serviceDrafts);
      this.setData({ serviceDrafts: previous.filter(item => item.id !== service.id) });
      const saved = await this.persistDraft();
      if (this.unloaded) return;
      if (saved) this.returnToManage();
      else this.setData({ serviceDrafts: previous });
      this.refreshDerived();
    } });
  },

  openWorkEditor(event) {
    if (this.confirmPendingEdit(() => this.openWorkEditor(event))) return;
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.workDrafts.some(work => work.id === id)) return;
    wx.navigateTo({ url: `/pages/provider-profile/index?edit=1&section=works&workId=${id}${this.auditMode ? "&audit=1" : ""}` });
  },

  openNewWorkEditor() {
    if (this.confirmPendingEdit(() => this.openNewWorkEditor())) return;
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    wx.navigateTo({ url: `/pages/provider-profile/index?edit=1&section=works${this.auditMode ? "&audit=1" : ""}` });
  },

  openWorkService() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages || this.data.cloudLoading) return;
    this.associationScrollTop = this.editorScrollTop || 0;
    this.setData({ workServicePickerOpen: true, workServiceDraftIndex: this.data.workServiceIndex || 0 }, () => wx.pageScrollTo({ scrollTop: 0, duration: 0 }));
  },
  selectWorkService(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.workServicePickerOpen || !Number.isInteger(index) || !this.data.workServiceOptions[index]) return;
    this.setData({ workServiceDraftIndex: index });
  },
  closeWorkService() {
    this.setData({ workServicePickerOpen: false }, () => wx.pageScrollTo({ scrollTop: this.associationScrollTop || 0, duration: 0 }));
  },
  confirmWorkService() {
    if (!this.data.workServicePickerOpen || this.unloaded || this.data.saving || this.data.uploadingImages) return;
    this.chooseWorkService({ detail: { value: this.data.workServiceDraftIndex } });
    this.closeWorkService();
  },
  chooseWorkService(event) {
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    const index = Number(event.detail.value);
    const option = Number.isInteger(index) && (this.data.workServiceOptions || [])[index];
    const work = this.data.workDrafts[this.data.selectedWorkIndex];
    if (!option || !work || option.id && !this.data.serviceDrafts.some(service => service.id === option.id)) return;
    const serviceDrafts = this.data.serviceDrafts.map(service => {
      const workIds = (service.workIds || []).filter(id => id !== work.id);
      if (service.id === option.id) workIds.push(work.id);
      return { ...service, workIds };
    });
    this.setData({ serviceDrafts }, () => this.refreshDerived());
  },

  updateWork(event) {
    if (this.unloaded || this.data.saving) return;
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
    if (key === "title") {
      const listIndex = this.data.workEditors.findIndex(item => item.id === workDrafts[index].id);
      if (listIndex >= 0) patch[`workEditors[${listIndex}].title`] = value;
    }
    if (key === "tagsText") patch.selectedWorkTagPreview = parseTags(value);
    this.setData(patch);
  },

  portfolioWorkState(work) {
    const count = (work.imagePreviews || []).length;
    const missing = !count ? '添加案例图片' : !String(work.title || '').trim() ? '填写案例名称' : !String(work.description || '').trim() ? '补充案例介绍' : '';
    const change = (this.data.reviewChanges || []).find(item => item.kind === 'work' && item.id === work.id);
    const media = [...(work.mediaStatuses || []), ...(work.sourceMediaStatuses || [])];
    const label = media.includes('REJECTED') ? '需修改图片' : this.data.activePublication || media.includes('PENDING_SECURITY_REVIEW') ? '检测中' : missing ? '待完善' : !this.data.reviewKnown ? '已保存' : change ? change.action === '新增' ? '草稿' : '有修改' : this.data.hasPublicVersion ? '已公开' : '草稿';
    return { stateLabel: label, detailLabel: missing || `${count} 张图片`, needsAttention: ['需修改图片','检测中','待完善'].includes(label) };
  },

  togglePortfolioPin(event) {
    if (this.unloaded || this.data.saving || this.data.cloudLoading || this.data.activePublication) return;
    const id = event.currentTarget.dataset.id;
    if (!this.data.workDrafts.some(work => work.id === id)) return;
    const pinned = this.data.pinnedDraft;
    if (!pinned.includes(id) && pinned.length >= 2) {
      wx.showToast({ title: "最多置顶 2 件作品，请先取消一件", icon: "none" });
      return;
    }
    this.setData({ pinnedDraft: pinned.includes(id) ? pinned.filter((item) => item !== id) : pinned.concat(id) }, async () => {
      const saved = await this.persistDraft();
      if (this.unloaded) return;
      if (!saved) this.setData({ pinnedDraft: pinned });
      this.refreshDerived();
    });
  },

  saveSelectedFile(file, prefix) {
    if (this.data.remoteEnabled) {
      return cloudCatalog.uploadImage({ ...file, preserveOriginal: prefix !== "work-watermark" && prefix !== "notice" }, prefix === "banner" ? "PROVIDER_BANNER" : prefix === "notice" ? "NOTICE_IMAGE" : "WORK_IMAGE").catch(error => { if (error.recoverableUpload) return error.recoverableUpload; throw error; }).then((uploaded) => {
        if (this.unloaded) {
          if (["PENDING", "REJECTED"].includes(uploaded.status)) cloudCatalog.cancelImage(uploaded.assetId, uploaded.fileId).catch(() => {});
        } else this.pendingCloudAssets.push(uploaded);
        return uploaded;
      });
    }
    if (file.size && file.size > 20 * 1024 * 1024) return Promise.reject(new Error("图片不能超过 20MB"));
    return new Promise((resolve, reject) => {
      wx.saveFile({
        tempFilePath: file.tempFilePath,
        success: ({ savedFilePath }) => {
          if (this.unloaded) wx.removeSavedFile({ filePath: savedFilePath, fail: () => {} });
          else this.pendingSavedFiles.push(savedFilePath);
          resolve(savedFilePath);
        },
        fail: reject
      });
    });
  },

  async consumeEntryUpload() {
    const files = pendingWorkUpload.consume();
    const work = this.data.workDrafts[this.data.selectedWorkIndex];
    if (files.length && work) return this.stageCaseImages(files, work.id);
  },

  stageCaseImages(files, workId) {
    const work = this.data.workDrafts.find(item => item.id === workId);
    if (!work || this.unloaded || this.data.uploadingImages || this.data.pendingImagePreviews.length) return;
    this.caseSelection = files.slice(0, Math.max(0, 5 - work.imagePreviews.length)).map(file => ({ ...file, spec: { enabled: false, text: '@' + (this.data.profileDraft.username || ''), position: 'bottom-right', size: 3, opacity: 60 } }));
    if (!this.caseSelection.length) return;
    this.setData({ imageSettings: { batch: true, index: 0, workId, preview: this.caseSelection[0].tempFilePath, spec: clone(this.caseSelection[0].spec), all: true }, caseSelectionPreviews: this.caseSelection.map((file, index) => ({ preview: file.tempFilePath, number: work.imagePreviews.length + index + 1 })), watermarkPositionIndex: 0, imageSettingsError: '', navTitle: '图片水印' });
  },
  saveCaseWatermark() {
    const settings = this.data.imageSettings;
    if (!settings || !settings.batch) return;
    for (let i = 0; i < this.caseSelection.length; i++) if (settings.all || i === settings.index) this.caseSelection[i].spec = clone(settings.spec);
  },
  selectCaseWatermark(event) {
    this.saveCaseWatermark();
    const index = Number(event.currentTarget.dataset.index), file = this.caseSelection[index];
    if (!file) return;
    this.setData({ 'imageSettings.index': index, 'imageSettings.preview': file.tempFilePath, 'imageSettings.spec': clone(file.spec), watermarkPositionIndex: ['bottom-right','bottom-left','top-right','top-left','center'].indexOf(file.spec.position) });
  },
  async finishCaseSelection() {
    if (this.data.uploadingImages || this.data.saving) return;
    this.saveCaseWatermark();
    try { this.caseSelection.forEach(file => workImageEdit.watermark(file.spec)); }
    catch (error) { this.setData({ imageSettingsError: error.message }); return; }
    const files = this.caseSelection, workId = this.data.imageSettings.workId;
    this.caseSelection = null;
    this.setData({ imageSettings: null, caseSelectionPreviews: [], imagesEditorOpen: false, navTitle: '编辑案例' });
    return this.uploadWorkImages(files, workId);
  },
  async uploadWorkImages(files, workId) {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    const current = () => !this.unloaded && (typeof getApp === 'function' ? getApp().globalData.account?.id : null) === owner;
    const work = this.data.workDrafts.find(item => item.id === workId);
    if (!work) return;
    if (!this.caseUploadBatch || !this.caseUploadBatch.length) this.caseUploadBatch = files.slice(0, Math.max(0, 5 - work.imagePreviews.length)).map((file, index) => ({ file, id: `${workId}:${Date.now()}:${index}`, state: '上传中' }));
    const batch = this.caseUploadBatch;
    if (!batch.length) return;
    this.failedImageWorkId = workId;
    this.editorReadSequence = (this.editorReadSequence || 0) + 1;
    const alive = item => current() && this.caseUploadBatch === batch && batch.includes(item);
    const paint = () => { if (current()) this.setData({ pendingImagePreviews: batch.map(item => ({ id: item.id, preview: item.displayPath || item.file.tempFilePath, state: item.state, progress: item.progress == null ? '' : item.progress })) }); };
    this.setData({ uploadingImages: true, cloudLoading: false, editorError: '' }); paint();
    try {
      // One canvas is shared. Finish rendering serially before concurrent transfers.
      for (const item of batch.slice()) {
        if (!alive(item) || item.result) continue;
        item.state = '上传中';
        try { if (!item.displayPath && workImageEdit.watermark(item.file.spec)) { item.state = '处理水印'; paint(); item.displayPath = await workImageEdit.render(this, item.file.tempFilePath, item.file.spec); } }
        catch (error) { item.state = '上传失败'; }
      }
      let next = 0;
      const queued = batch.filter(item => !item.result && item.state !== '上传失败');
      await Promise.all([0, 1].map(async () => {
        while (next < queued.length && current()) {
          const item = queued[next++]; if (!alive(item)) continue;
          try {
            item.state = '上传中'; paint();
            const onProgress = ({ progress }) => { if (alive(item)) { item.progress = Math.min(100, Math.max(0, Number(progress) || 0)); paint(); } };
            if (!item.source) item.source = await this.saveSelectedFile({ ...item.file, onProgress }, `work-${workId}`);
            if (!alive(item)) continue;
            if (item.displayPath) item.progress = 0;
            item.result = item.displayPath ? await this.saveSelectedFile({ tempFilePath: item.displayPath, onProgress }, 'work-watermark') : item.source;
            if (!alive(item)) continue;
            item.state = '上传完成'; item.progress = 100;
          } catch (error) { if (alive(item)) { item.state = '上传失败'; item.progress = ''; } }
          paint();
        }
      }));
      if (!current()) return;
      this.failedImageFiles = batch.filter(item => !item.result).map(item => item.file);
      this.setData({ editorError: this.failedImageFiles.length ? `${this.failedImageFiles.length} 张图片上传失败，请原位重试或删除；其他图片已保留。` : '' });
      this.commitCaseUploadBatch(workId);
      this.scheduleMediaReview(0);
    } finally {
      if (current()) this.setData({ uploadingImages: false });
      else if (!this.unloaded && this.caseUploadBatch === batch) { this.caseUploadBatch = null; this.failedImageFiles = []; this.setData({ uploadingImages: false, pendingImagePreviews: [] }); }
    }
  },
  commitCaseUploadBatch(workId) {
    const batch = this.caseUploadBatch || [];
    if (batch.some(item => !item.result)) return;
    const found = this.data.workDrafts.find(item => item.id === workId);
    if (!found) return;
    const work = workImageEdit.prepare(found);
    for (const item of batch) {
      for (const [asset, prefix] of [[item.result, ''], [item.source, 'source']]) {
        work[prefix ? 'sourceImagePreviews' : 'imagePreviews'].push(typeof asset === 'string' ? asset : asset.preview);
        work[prefix ? 'sourceImageAssetIds' : 'imageAssetIds'].push(typeof asset === 'string' ? '' : asset.assetId);
        work[prefix ? 'sourceMediaStatuses' : 'mediaStatuses'].push(typeof asset === 'string' ? '' : asset.status);
      }
      work.watermarks.push(workImageEdit.watermark(item.file.spec));
    }
    work.imageCount = work.imagePreviews.length;
    this.caseUploadBatch = null; this.failedImageFiles = [];
    this.setData({ workDrafts: this.data.workDrafts.map(item => item.id === workId ? work : item), pendingImagePreviews: [], editorError: '' }, () => this.refreshDerived());
  },
  removeCasePendingImage(event) {
    if (this.data.saving) return;
    const id = event.currentTarget.dataset.id, batch = this.caseUploadBatch;
    if (!batch) return;
    const index = batch.findIndex(item => item.id === id); if (index < 0) return;
    batch.splice(index, 1);
    this.setData({ pendingImagePreviews: this.data.pendingImagePreviews.filter(item => item.id !== id) });
    if (!this.data.uploadingImages) this.commitCaseUploadBatch(this.failedImageWorkId);
  },
  discardFailedImages() {
    if (this.data.uploadingImages || this.data.saving) return;
    for (const item of (this.caseUploadBatch || []).slice()) if (!item.result) this.removeCasePendingImage({ currentTarget: { dataset: { id: item.id } } });
  },
  retryWorkImages() {
    if (this.failedImageWorkId !== this.data.selectedWork?.id) return;
    for (const item of this.caseUploadBatch || []) if (!item.result) item.state = '上传中';
    return this.uploadWorkImages(this.failedImageFiles || [], this.failedImageWorkId);
  },

  scheduleMediaReview(attempt = 0) {
    if (this.mediaReviewTimer) clearTimeout(this.mediaReviewTimer);
    if (this.unloaded || this.editorHidden || !this.data.remoteEnabled || attempt >= 4) return;
    const pending = this.data.workDrafts.some(work => [...(work.mediaStatuses || []), ...(work.sourceMediaStatuses || [])].includes('PENDING_SECURITY_REVIEW'));
    if (!pending || typeof setTimeout !== 'function') return;
    this.mediaReviewTimer = setTimeout(() => this.refreshMediaReview(attempt), [1000, 2000, 3000, 5000][attempt]);
    if (this.mediaReviewTimer.unref) this.mediaReviewTimer.unref();
  },
  async refreshMediaReview(attempt = 0) {
    attempt = Number.isInteger(attempt) ? attempt : 0;
    if (this.unloaded || this.editorHidden || this.reviewReading || !this.data.remoteEnabled) return;
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    const ids = [...new Set(this.data.workDrafts.flatMap(work => ['imageAssetIds', 'sourceImageAssetIds'].flatMap(key => (work[key] || []).filter((id, index) => id && (work[key === 'imageAssetIds' ? 'mediaStatuses' : 'sourceMediaStatuses'] || [])[index] === 'PENDING_SECURITY_REVIEW'))))];
    if (!ids.length) return;
    this.reviewReading = true;
    try {
      const results = await Promise.allSettled(ids.map(id => cloudCatalog.getImageStatus(id)));
      if (this.unloaded || this.editorHidden || owner !== (typeof getApp === 'function' ? getApp().globalData.account?.id : null)) return;
      this.setData({ mediaReviewMessage: results.some(item => item.status === 'rejected') ? '暂时无法获取审核结果，草稿可继续编辑，请稍后刷新。' : attempt >= 3 ? '审核尚未结束，可先保存草稿，稍后返回查看。' : '' });
      const statuses = new Map(results.filter(item => item.status === 'fulfilled' && ['READY', 'REJECTED'].includes(item.value.status) && ids.includes(item.value.assetId)).map(item => [item.value.assetId, item.value.status]));
      if (statuses.size) {
        this.setData({ workDrafts: this.data.workDrafts.map(work => ({ ...work,
          mediaStatuses: (work.imageAssetIds || []).map((id, i) => statuses.get(id) || (work.mediaStatuses || [])[i]),
          sourceMediaStatuses: (work.sourceImageAssetIds || []).map((id, i) => statuses.get(id) || (work.sourceMediaStatuses || [])[i]) })) }, () => this.refreshDerived());
        cloudCatalog.clearDraftCache();
      }
    } finally { this.reviewReading = false; this.scheduleMediaReview(Number(attempt) + 1); }
  },

  selectWorkImage(event) { this.setData({ selectedImageIndex: Number(event.currentTarget.dataset.index) }); },
  startImageDrag(event) {
    if (this.data.saving || this.data.uploadingImages) return;
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ selectedImageIndex: index, dragImageIndex: index, dragTargetIndex: index });
    this.createSelectorQuery().selectAll('.composer-image-item[data-sortable]').boundingClientRect(rects => { this.imageDragRects = rects; }).exec();
  },
  dragWorkImage(event) {
    if (this.data.dragImageIndex == null || !event.touches?.[0]) return;
    const touch = event.touches[0];
    const index = (this.imageDragRects || []).findIndex(rect => touch.clientX >= rect.left && touch.clientX <= rect.right && touch.clientY >= rect.top && touch.clientY <= rect.bottom);
    if (index >= 0 && index !== this.data.dragTargetIndex) this.setData({ dragTargetIndex: index });
  },
  finishImageDrag() {
    const from = this.data.dragImageIndex, to = this.data.dragTargetIndex;
    if (from != null && to != null && from !== to) this.moveWorkImage({ currentTarget: { dataset: { index: from, to } } });
    this.setData({ dragImageIndex: null, dragTargetIndex: null }); this.imageDragRects = null;
  },
  cancelImageDrag() { this.setData({ dragImageIndex: null, dragTargetIndex: null }); this.imageDragRects = null; },

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

  chooseBanner() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    const current = () => !this.unloaded && (typeof getApp === 'function' ? getApp().globalData.account?.id : null) === owner;
    chooseImageMedia({ count: 1, sizeType: ['compressed'], success: async ({ tempFiles }) => {
      if (!tempFiles[0] || !current() || this.data.saving || this.data.uploadingImages) return;
      this.setData({ uploadingImages: true, editorError: '' });
      try {
        const uploaded = await this.saveSelectedFile(tempFiles[0], 'banner');
        if (!current()) return;
        this.setData({ 'profileDraft.bannerSourceAssetId': typeof uploaded === 'string' ? null : uploaded.assetId, 'profileDraft.bannerSourceImage': typeof uploaded === 'string' ? uploaded : uploaded.preview, 'profileDraft.bannerFocusX':50, 'profileDraft.bannerFocusY':50, bannerCropChanged:true, 'profileDraft.bannerImage': typeof uploaded === 'string' ? uploaded : uploaded.preview,
          'profileDraft.bannerAssetId': typeof uploaded === 'string' ? null : uploaded.assetId });
      } catch (_) { if (current()) this.setData({ editorError: '头图上传失败，原图已保留，请重试。' }); }
      finally { if (current()) this.setData({ uploadingImages: false }); }
      if (current() && this.data.bannerCropChanged) this.updateBannerFocus({ currentTarget: { dataset: { key: 'bannerFocusX' } }, detail: { value: 50 } });
    } });
  },
  removeNoticeImage() {
    if(this.unloaded || this.data.saving || this.data.uploadingImages)return;
    this.removePendingFile(this.data.noticeImageDraft);this.setData({noticeImageDraft:'',noticeImageAssetId:null});
  },
  removeBanner() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    this.setData({ 'profileDraft.bannerImage': '', 'profileDraft.bannerAssetId': null, 'profileDraft.bannerSourceAssetId':null, 'profileDraft.bannerSourceImage':'', bannerCropPreview:'', bannerCropChanged:false });
  },
  chooseNoticeImage() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    const current = () => !this.unloaded && (typeof getApp === 'function' ? getApp().globalData.account?.id : null) === owner;
    chooseImageMedia({ count: 1, sizeType: ["compressed"], success: async ({ tempFiles }) => {
      if (!tempFiles[0] || !current() || this.data.saving || this.data.uploadingImages) return;
      this.editorReadSequence = (this.editorReadSequence || 0) + 1;
      this.setData({ uploadingImages: true, cloudLoading: false, editorError: "" });
      try {
        const previous = this.data.noticeImageDraft;
        const uploaded = await this.saveSelectedFile(tempFiles[0], "notice");
        if (!current()) return;
        const image = typeof uploaded === "string" ? uploaded : uploaded.preview;
        this.removePendingFile(previous);
        this.setData({ noticeImageOpen: true, noticeImageDraft: image, noticeImageAssetId: typeof uploaded === "string" ? this.data.noticeImageAssetId : uploaded.assetId });
      } catch (error) {
        if (current()) this.setData({ editorError: "须知图片上传失败，原图片和文字已保留，请重新选择图片。" });
      } finally {
        if (!this.unloaded) this.setData({ uploadingImages: false });
      }
    } });
  },

  chooseWorkImages() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    const current = this.data.workDrafts[this.data.selectedWorkIndex];
    if (!current) return;
    const remaining = Math.max(0, 5 - (current.imagePreviews || []).length);
    if (!remaining) return wx.showToast({ title: "每件作品最多 5 张图片，请先移除一张", icon: "none" });
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    wx.showActionSheet({ itemList: ['从相册选择', '拍照'], success: ({ tapIndex }) => {
      chooseImageMedia({ count: remaining, sourceType: [tapIndex === 1 ? 'camera' : 'album'], sizeType: ['compressed'], success: ({ tempFiles }) => {
        if (!this.unloaded && this.data.selectedWork?.id === current.id && (typeof getApp === 'function' ? getApp().globalData.account?.id : null) === owner) this.stageCaseImages(tempFiles, current.id);
      } });
    } });
  },

  openImageSettings(event) {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    const index = Number(event.currentTarget.dataset.index || 0), work = this.data.selectedWork;
    if (!work || !work.imagePreviews[index]) return;
    const storedSpec = (work.watermarks || [])[index];
    const spec = storedSpec ? clone(storedSpec) : null;
    this.setData({ watermarkPositionIndex: Math.max(0, ['bottom-right','bottom-left','top-right','top-left','center'].indexOf(spec && spec.position)), imageSettings: { index, workId: work.id, preview: (work.sourceImagePreviews || [])[index] || work.imagePreviews[index], spec: spec || { enabled: false, text: '@' + (this.data.profileDraft.username || ''), position: 'bottom-right', size: 3, opacity: 60 }, all: false }, imageSettingsError: '', navTitle: '图片设置' });
  },
  closeImageSettings() {
    if (this.data.uploadingImages) return;
    this.caseSelection = null;
    this.setData({ caseSelectionPreviews: [], imageSettings: null, navTitle: this.data.imagesEditorOpen ? '管理图片' : '编辑案例', imageSettingsError: '' });
  },
  updateWatermark(event) {
    if (this.data.uploadingImages || this.data.saving || !this.data.imageSettings) return;
    const key = event.currentTarget.dataset.key;
    if (key === 'position') this.setData({ watermarkPositionIndex: Number(event.detail.value) });
    const value = key === 'position' ? ['bottom-right','bottom-left','top-right','top-left','center'][Number(event.detail.value)] : event.detail.value;
    this.setData({ [key === 'all' ? 'imageSettings.all' : 'imageSettings.spec.' + key]: value, imageSettingsError: '' });
  },
  async applyWatermark() {
    if (!this.data.imageSettings || this.data.uploadingImages || this.data.saving) return;
    if (this.data.imageSettings.batch) return this.finishCaseSelection();
    const settings = clone(this.data.imageSettings), work = workImageEdit.prepare(this.data.selectedWork);
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    const current = () => !this.unloaded && (typeof getApp === 'function' ? getApp().globalData.account?.id : null) === owner && this.data.selectedWork && this.data.selectedWork.id === work.id;
    this.setData({ uploadingImages: true, imageSettingsError: '' });
    try {
      const spec = workImageEdit.watermark(settings.spec), key = JSON.stringify(spec);
      for (let i = 0; i < work.imagePreviews.length; i++) {
        if (!settings.all && i !== settings.index || JSON.stringify(work.watermarks[i]) === key) continue;
        if (!current()) throw new Error('账号或作品已变化，请重新进入编辑');
        if (spec) {
          const path = await workImageEdit.render(this, work.sourceImagePreviews[i], spec);
          if (!current()) throw new Error('账号或作品已变化，请重新进入编辑');
          const asset = await this.saveSelectedFile({ tempFilePath: path }, 'work-watermark');
          if (!current()) throw new Error('账号或作品已变化，请重新进入编辑');
          work.imagePreviews[i] = typeof asset === 'string' ? asset : asset.preview;
          work.imageAssetIds[i] = typeof asset === 'string' ? '' : asset.assetId;
          work.mediaStatuses[i] = typeof asset === 'string' ? '' : asset.status;
        } else {
          work.imagePreviews[i] = work.sourceImagePreviews[i]; work.imageAssetIds[i] = work.sourceImageAssetIds[i]; work.mediaStatuses[i] = work.sourceMediaStatuses[i];
        }
        work.watermarks[i] = spec;
      }
      if (current()) this.setData({ workDrafts: this.data.workDrafts.map(item => item.id === work.id ? work : item), imageSettings: null, navTitle: this.data.imagesEditorOpen ? '管理图片' : '编辑案例' }, () => this.refreshDerived());
    } catch (error) { if (current()) this.setData({ imageSettingsError: error.message || '处理失败，当前作品未改动，请重试。' }); }
    finally { if (!this.unloaded) this.setData({ uploadingImages: false }); }
  },
  moveWorkImage(event) {
    if (this.data.saving || this.data.uploadingImages) return;
    const { index, to } = event.currentTarget.dataset, selected = this.data.selectedWork;
    const work = workImageEdit.move(selected, Number(index), Number(to));
    this.setData({ selectedImageIndex: Number(to), workDrafts: this.data.workDrafts.map(item => item.id === work.id ? work : item) }, () => this.refreshDerived());
  },
  replaceWorkImage(event) {
    if (this.data.saving || this.data.uploadingImages) return;
    const index = Number(event.currentTarget.dataset.index), selected = this.data.selectedWork;
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    const current = () => !this.unloaded && (typeof getApp === 'function' ? getApp().globalData.account?.id : null) === owner;
    chooseWorkMedia({ count: 1, success: async ({ tempFiles }) => {
      if (!tempFiles.length || !current() || this.data.saving || this.data.uploadingImages || this.data.selectedWork !== selected) return;
      this.setData({ uploadingImages: true, editorError: '' });
      try {
        const asset = await this.saveSelectedFile(tempFiles[0], 'work-replace');
        if (!current()) return;
        const work = workImageEdit.prepare(selected), path = typeof asset === 'string' ? asset : asset.preview;
        work.imagePreviews[index] = work.sourceImagePreviews[index] = path;
        work.imageAssetIds[index] = work.sourceImageAssetIds[index] = typeof asset === 'string' ? '' : asset.assetId;
        work.mediaStatuses[index] = work.sourceMediaStatuses[index] = typeof asset === 'string' ? '' : asset.status;
        work.watermarks[index] = null;
        this.setData({ workDrafts: this.data.workDrafts.map(item => item.id === work.id ? work : item) }, () => this.refreshDerived());
      } catch (error) { if (current()) this.setData({ editorError: '替换失败，原图片已保留，请重试。' }); }
      finally { if (!this.unloaded) this.setData({ uploadingImages: false }); }
    } });
  },
  removeWorkImage(event) {
    if (this.unloaded || this.data.saving) return;
    const imageIndex = Number(event.currentTarget.dataset.index);
    const workIndex = this.data.selectedWorkIndex;
    const selected = this.data.workDrafts[workIndex];
    if (!selected || !Number.isInteger(imageIndex) || imageIndex < 0 || imageIndex >= selected.imagePreviews.length) return;
    const removedPath = (selected.imagePreviews || [])[imageIndex];
    this.removePendingFile(removedPath);
    const workDrafts = this.data.workDrafts.map((work, index) => index === workIndex ? workImageEdit.remove(work, imageIndex) : work);
    this.setData({ workDrafts }, () => this.refreshDerived());
  },

  requestRemoveWorkImage(event) {
    if (this.unloaded || this.data.saving) return;
    const work = this.data.selectedWork, index = Number(event.currentTarget.dataset.index);
    wx.showModal({ title: '移除这张图片？', content: '保存案例草稿后保留此修改，尚未发布的修改不会改变公开内容。', confirmText: '移除图片', success: ({ confirm }) => {
      if (confirm && !this.unloaded && this.data.selectedWork === work) this.removeWorkImage({ currentTarget: { dataset: { index } } });
    } });
  },
  requestRemoveBanner() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages || this.data.bannerCropping) return;
    const asset = this.data.profileDraft.bannerAssetId;
    wx.showModal({ title: '移除主页头图？', content: '头图移除后保留简洁的资料区，不会自动使用案例图片。保存草稿后再确认发布。', confirmText: '移除头图', success: ({ confirm }) => {
      if (confirm && !this.unloaded && asset === this.data.profileDraft.bannerAssetId) this.removeBanner();
    } });
  },

  requestCancelWork() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    const snapshot = this.workEditSnapshot;
    if (!this.data.pendingImagePreviews.length && (!snapshot || JSON.stringify(snapshot) === JSON.stringify(this.buildDraftValue()))) return this.cancelEdit();
    this.chooseLeave('保存草稿并返回', () => this.saveWork(), () => this.cancelEdit());
  },

  cancelEdit() {
    if (this.data.saving || this.data.uploadingImages) return;
    this.caseUploadBatch = null; this.failedImageFiles = []; this.setData({ pendingImagePreviews: [] });
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
    this.unloaded = true;
    if (this.mediaReviewTimer) clearTimeout(this.mediaReviewTimer);
    this.keyboardSequence = (this.keyboardSequence || 0) + 1;
    this.activeKeyboardField = null;
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
      servicePrice: Number(first.price || 0),
      serviceDescription: first.description || ""
    });
    const works = this.data.workDrafts.map(({ tagsText, ...work }) => Object.assign({}, work, {
      tags: parseTags(tagsText == null ? (work.tags || []).join(",") : tagsText), price: work.price == null || work.price === "" ? null : Number(work.price)
    }));
    return {
      career: this.data.career,
      profile,
      services: this.data.serviceDrafts.map(service => Object.assign({}, service, { price: Number(service.price || 0) })),
      works,
      pinnedWorkIds: this.data.pinnedDraft,
      noticeImageAssetId: this.data.noticeImageAssetId,
      noticeImage: this.data.noticeImageDraft
    };
  },

  openDraftPreview(draft, draftVersion, visitor = false, publication = '') {
    if (this.unloaded) return;
    const providerId = this.serverProviderId || store.CURRENT_PROVIDER_ID;
    storefrontPreviewDraft.stage({
      providerId,
      statistics: this.publicStatistics || {},
      profile: draft.profile,
      services: draft.services,
      works: draft.works,
      pinnedWorkIds: draft.pinnedWorkIds,
      noticeImage: draft.noticeImage,
      draftVersion
    });
    this.previewOpen = true;
    this.publicationProgressOpen = !!publication;
    wx.navigateTo({
      url: `/pages/provider-detail/index?id=${providerId}&workspace=provider&preview=storefront${visitor ? "&visitor=1" : ""}${publication ? "&publication=" + publication : ""}${this.auditMode ? "&audit=1" : ""}`,
      success: () => this.setData({ saving: false }),
      fail: () => {
        this.previewOpen = false;
        storefrontPreviewDraft.clear();
        this.setData({ saving: false });
        wx.showToast({ title: "预览打开失败，本次修改已保留", icon: "none" });
      }
    });
  },

  saveAndPreview() { return this.previewSaved(true); },

  fixPublicationIssue(event) {
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    const issue = publicationReadiness(this.data.profileDraft, this.data.serviceDrafts, this.data.workDrafts).issues.find(item => item.key === event.currentTarget.dataset.key);
    if (!issue) return;
    if (issue.type === 'account') return this.openAccount();
    if (issue.type === 'profile') return this.openSection({ currentTarget: { dataset: { section: 'profile' } } });
    if (issue.type === 'new-service') return this.addService();
    if (issue.type === 'service') return this.toggleServiceEditor({ currentTarget: { dataset: { id: issue.id } } });
    if (issue.type === 'work') return this.openWorkEditor({ currentTarget: { dataset: { id: issue.id } } });
  },

  updatePublicationSummary(intent) {
    this.currentPublicationIntent = intent || null;
    const status = intent && intent.status;
    const pending = ['PENDING','STAGED'].includes(status);
    const labels = { PENDING:'正在检测，尚未公开', STAGED:'正在提交，尚未公开', FAILED:'本次更新需要修改', EXPIRED:'本次检测已过期', CANCELLED:'本次发布已撤回', APPLIED:'本次内容已公开' };
    this.setData({ activePublication: pending, publicationStatusLabel: labels[status] || '', publicationStatusHint: pending ? '检测通过后才公开，已有公开内容保持展示。' : status === 'FAILED' ? '草稿已保留，请查看原因并修改。' : '' });
  },
  async openPublicationCheck() {
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    this.managerScrollTop = this.editorScrollTop || 0;
    this.setData({ managementTab: 'check', navTitle: '本次发布确认' }, () => wx.pageScrollTo({ scrollTop: 0, duration: 0 }));
    return this.loadPublicationReview();
  },
  async loadPublicationReview() {
    if (this.unloaded || this.data.reviewLoading) return;
    const owner = this.serverProviderId, version = this.data.remoteDraftVersion;
    this.setData({ reviewLoading:true, reviewError:'', reviewKnown:false });
    try {
      const value = this.auditMode ? { publication:null, draftVersion:version } : await cloudCatalog.getWorkspaceReview();
      if (this.unloaded || owner !== this.serverProviderId || version !== this.data.remoteDraftVersion) return;
      if (value.draftVersion !== version) throw Object.assign(new Error('conflict'),{code:'VERSION_CONFLICT'});
      this.updatePublicationSummary(value.contentIntent);
      this.setData({ reviewChanges: storefrontChanges.changes(cloudCatalog.toServerDraft(this.savedDraft), value.publication), reviewKnown:true, hasPublicVersion:!!value.publication }, () => this.refreshDerived());
    } catch(error) { if (!this.unloaded && owner === this.serverProviderId) this.setData({ reviewError:error.code === 'VERSION_CONFLICT' ? '草稿已在其他页面更新，请重新读取后核对。' : '本次变更未能读取，请重试。草稿仍保留。' }); }
    finally { if (!this.unloaded && owner === this.serverProviderId) this.setData({ reviewLoading:false }); }
  },
  editReviewChange(event) {
    const item = this.data.reviewChanges.find(x=>x.key === event.currentTarget.dataset.key);
    if (!item || item.action === '移除' || this.data.saving) return;
    if (item.kind === 'service') return this.toggleServiceEditor({currentTarget:{dataset:{id:item.id}}});
    if (item.kind === 'work') return this.openWorkEditor({currentTarget:{dataset:{id:item.id}}});
    return this.openSection({currentTarget:{dataset:{section:item.kind}}});
  },
  submitPublication() {
    if (this.unloaded || this.data.saving || this.data.reviewLoading || !this.data.reviewKnown || this.data.activePublication || !this.data.canPublish || !this.data.reviewChanges.length) return;
    this.openDraftPreview(clone(this.savedDraft), this.data.remoteDraftVersion, false, 'submit');
  },
  openPublicationProgress() {
    if (this.unloaded || this.data.saving || !this.savedDraft) return;
    this.openDraftPreview(clone(this.savedDraft), this.data.remoteDraftVersion, false, 'resume');
  },

  openManagementTab(event) {
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    const tab = event.currentTarget.dataset.tab;
    if (!['works', 'services'].includes(tab)) return;
    this.managerScrollTop = this.editorScrollTop || 0;
    this.setData({ profileTab: tab, managementTab: tab, navTitle: tab === "services" ? "服务项目" : "作品集" }, () => wx.pageScrollTo({ scrollTop: 0, duration: 0 }));
  },
  chooseProfileTab(event) { if (this.unloaded || this.data.saving || this.data.cloudLoading) return; this.setData({ profileTab: event.currentTarget.dataset.tab }); },
  previewSaved(visitor = true) {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    if (!this.savedDraft) return wx.showToast({ title: '请先保存一份草稿', icon: 'none' });
    const draft = clone(this.savedDraft);
    const version = this.data.remoteDraftVersion;
    const open = () => { if (!this.unloaded && !this.data.saving && this.data.remoteDraftVersion === version) this.openDraftPreview(draft, this.data.remoteEnabled ? version : null, visitor === true); };
    if (JSON.stringify(cloudCatalog.toServerDraft(this.buildDraftValue())) !== JSON.stringify(cloudCatalog.toServerDraft(draft))) {
      return wx.showModal({ title: '有尚未保存的修改', content: '本次预览只展示上次保存的内容。若要预览新修改，请返回编辑并点击保存草稿。', confirmText: '看已存草稿', cancelText: '继续编辑', success: ({ confirm }) => { if (confirm) open(); } });
    }
    open();
  },
  chooseLeave(saveLabel, save, discard) {
    if (this.unloaded || this.data.saving || this.data.uploadingImages || this.data.bannerCropping) return;
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    const version = this.data.remoteDraftVersion, view = this.data.editorView;
    wx.showActionSheet({ itemList: [saveLabel, '继续编辑', '放弃本次修改并返回'], success: ({ tapIndex }) => {
      if (this.unloaded || this.data.saving || this.data.uploadingImages || this.data.remoteDraftVersion !== version || this.data.editorView !== view || owner !== (typeof getApp === 'function' ? getApp().globalData.account?.id : null)) return;
      if (tapIndex === 0) save();
      else if (tapIndex === 2) discard();
    } });
  },
  navigateEditorBack() {
    if (!this.data.imageSettings && this.data.imagesEditorOpen) return this.closeImagesEditor();
    if (this.data.bannerEditorOpen) {
      if (JSON.stringify(this.bannerEditSnapshot) === JSON.stringify(this.data.profileDraft)) return this.closeBannerEditor();
      return this.chooseLeave('完成取景并返回', () => this.closeBannerEditor(), () => {
        this.setData({ profileDraft: clone(this.bannerEditSnapshot), bannerEditorOpen: false, bannerCropChanged: false, bannerCropPreview: '', navTitle: '橱窗资料' });
      });
    }
    if (this.data.sectionSaveComplete) return this.finishSavedSection();
    if (this.data.workPickerOpen) return this.closeWorkPicker();
    if (this.data.workServicePickerOpen) return this.closeWorkService();
    if (this.data.imageSettings) {
      if (this.data.imageSettings.batch) return this.chooseLeave('设置完成并上传', () => this.finishCaseSelection(), () => this.closeImageSettings());
      if (this.data.uploadingImages) return;
      return this.chooseLeave('应用设置并返回图片', () => this.applyWatermark(), () => this.closeImageSettings());
    }
    if (this.data.saving || this.data.uploadingImages) return;
    if (this.data.textEditor) return this.cancelTextEditor();
    if (this.data.editorSection === 'works') return this.requestCancelWork();
    if (this.data.editorView !== 'manage') {
      const snapshot = this.editSnapshot;
      if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(this.buildDraftValue())) {
        this.chooseLeave('保存草稿并返回', () => this.saveSection(), () => this.cancelSection());
      } else this.cancelSection();
      return;
    }
    if (this.data.managementTab) {
      this.setData({ managementTab: '', navTitle: '管理橱窗' }, () => wx.pageScrollTo({ scrollTop: this.managerScrollTop || 0, duration: 0 }));
    }
  },

  confirmPendingEdit(proceed) {
    if (!this.data.activePublication) return false;
    const intent=this.currentPublicationIntent, owner=this.serverProviderId;
    if(!intent?.id || this.data.saving)return true;
    wx.showModal({title:'先撤回本次提交再修改？',content:'草稿会保留。旧公开内容继续展示；若本次内容已经公开，会保留真实公开结果。',confirmText:'撤回并修改',success:async({confirm})=>{
      if(!confirm || this.unloaded || owner!==this.serverProviderId || this.data.saving)return;
      this.setData({saving:true});
      try{const result=await cloudCatalog.cancelPublishIntent(intent.id);if(this.unloaded || owner!==this.serverProviderId)return;this.updatePublicationSummary(result);cloudCatalog.resetPublicationRequest();this.setData({saving:false});proceed();}
      catch(_){if(!this.unloaded)this.setData({editorError:'撤回结果未确认，请先查看发布进度。'});}
      finally{if(!this.unloaded && owner===this.serverProviderId)this.setData({saving:false});}
    }});return true;
  },
  openSetupStep(event) {
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    const service = event.currentTarget.dataset.step === 'service';
    return this.openManagementTab({ currentTarget: { dataset: { tab: service ? 'services' : 'works' } } });
  },
  openImagesEditor() { if (!this.unloaded && !this.data.saving) this.setData({ imagesEditorOpen: true, navTitle: '管理图片' }); },
  closeImagesEditor() { if (!this.data.uploadingImages && !this.data.saving) this.setData({ imagesEditorOpen: false, navTitle: '编辑案例' }); },
  toggleImageTools(event) { const index = Number(event.currentTarget.dataset.index); this.setData({ imageToolsIndex: this.data.imageToolsIndex === index ? -1 : index }); },
  previewOriginalImage(event) {
    const work = this.data.selectedWork, index = Number(event.currentTarget.dataset.index);
    const urls = work && (work.sourceImagePreviews || work.imagePreviews) || [];
    if (urls[index]) wx.previewImage({ current: urls[index], urls: urls.filter(Boolean) });
  },
  openBannerEditor() { if (this.unloaded || this.data.saving || this.data.uploadingImages) return; this.bannerEditSnapshot = clone(this.data.profileDraft); this.setData({ bannerEditorOpen: true, bannerCropChanged: false, bannerCropPreview: '', navTitle: '主页头图' }); },
  async updateBannerFocus(event) {
    if (this.data.uploadingImages || this.data.saving) return;
    const key = event.currentTarget.dataset.key;
    if (!['bannerFocusX','bannerFocusY'].includes(key)) return;
    this.setData({['profileDraft.'+key]:Number(event.detail.value),bannerCropChanged:true});
    const sequence=this.bannerCropSequence=(this.bannerCropSequence||0)+1, owner=this.serverProviderId;
    this.setData({bannerCropping:true});
    try {
      const p=this.data.profileDraft, result=await bannerCrop.render(this,p.bannerSourceImage||p.bannerImage,p.bannerFocusX,p.bannerFocusY);
      if (!this.unloaded && sequence===this.bannerCropSequence && owner===this.serverProviderId) this.setData({bannerCropPreview:result});
    } catch (_) { if(!this.unloaded)this.setData({editorError:'取景预览失败，原头图保留，请重试。'}); }
    finally { if(!this.unloaded && sequence===this.bannerCropSequence)this.setData({bannerCropping:false}); }
  },
  async closeBannerEditor() {
    if (this.data.saving || this.data.uploadingImages || this.data.bannerCropping) return;
    if (this.data.bannerCropChanged && this.data.profileDraft.bannerImage) {
      const owner=this.serverProviderId, account=typeof getApp==='function'?getApp().globalData.account?.id:null;
      const current=()=>!this.unloaded && owner===this.serverProviderId && account===(typeof getApp==='function'?getApp().globalData.account?.id:null);
      this.setData({uploadingImages:true,editorError:''});
      try {
        const p=this.data.profileDraft, file=await bannerCrop.render(this,p.bannerSourceImage||p.bannerImage,p.bannerFocusX,p.bannerFocusY);
        if(!current())return;
        const uploaded=await this.saveSelectedFile({tempFilePath:file},'banner');
        if(!current())return;
        this.setData({'profileDraft.bannerAssetId':typeof uploaded==='string'?null:uploaded.assetId,'profileDraft.bannerImage':typeof uploaded==='string'?uploaded:uploaded.preview,bannerCropChanged:false,bannerCropPreview:''});
      } catch(_){if(current())this.setData({editorError:'头图取景保存失败，修改保留，请重试。'});return;}
      finally{if(current())this.setData({uploadingImages:false});}
    }
    if(!this.unloaded)this.setData({bannerEditorOpen:false,navTitle:'橱窗资料'});
  },
  toggleOptional(event) {
    const key = event.currentTarget.dataset.key;
    if (this.unloaded || this.data.saving || !['serviceDetailsOpen','workCreditsOpen','profilePreferencesOpen','noticeImageOpen'].includes(key)) return;
    this.setData({ [key]: !this.data[key] });
  },
  createAssociatedService() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages || !this.data.workServicePickerOpen || this.data.serviceDrafts.length >= 20) return;
    this.associationServiceReturn = { services: clone(this.data.serviceDrafts), navTitle: this.data.navTitle, section: this.data.editorSection, view: this.data.editorView, editSnapshot: this.editSnapshot };
    this.setData({ workServicePickerOpen: false, editorSection: 'profile', addingServiceForWork: true });
    this.addService();
  },
  returnToWorkAssociation(service) {
    const parent = this.associationServiceReturn;
    if (!parent || this.unloaded) return;
    this.associationServiceReturn = null;
    this.editSnapshot = parent.editSnapshot;
    this.setData({ editorSection: parent.section, editorView: parent.view, navTitle: parent.navTitle, addingServiceForWork: false,
      serviceDrafts: service ? parent.services.concat(service) : parent.services, workServicePickerOpen: true, editorError: '' });
    this.refreshDerived();
    if (service) this.setData({ workServiceDraftIndex: this.data.workServiceOptions.findIndex(item => item.id === service.id) });
  },
  async saveAssociatedService() {
    const service = clone(this.data.serviceDrafts[this.data.activeServiceIndex]);
    if (!this.associationServiceReturn || !this.savedDraft || !service) return;
    // Saving the new service must not save the still-edited parent work or its associations.
    const draft = clone(this.savedDraft); draft.services.push({ ...service, workIds: [] });
    const pendingAssets = this.pendingCloudAssets, pendingFiles = this.pendingSavedFiles;
    const saved = await this.persistDraft(draft);
    if (this.unloaded) return;
    this.pendingCloudAssets = pendingAssets; this.pendingSavedFiles = pendingFiles;
    if (saved) { this.returnToWorkAssociation({ ...service, workIds: [] }); wx.showToast({ title: '服务草稿已保存，请确认关联', icon: 'none' }); }
  },
  openTextEditor(event) {
    if (this.unloaded || this.data.saving || this.data.cloudLoading) return;
    const { scope, key, title, max } = event.currentTarget.dataset;
    const allowed = { profile: ['bio','tags','specialties','declines','contactHours','notice'], service: ['description','includes','extras','preparation'], work: ['description','tagsText','creditCoser','creditPhoto','creditMakeup','creditRetouch','creditMine'] };
    if (!allowed[scope] || !allowed[scope].includes(key)) return;
    const index = scope === 'service' ? this.data.activeServiceIndex : this.data.selectedWorkIndex;
    const source = scope === 'profile' ? this.data.profileDraft : scope === 'service' ? this.data.serviceDrafts[index] : this.data.workDrafts[index];
    if (!source) return;
    this.textParent = { title: this.data.navTitle, scrollTop: this.editorScrollTop || 0, sourceId: source.id, owner: typeof getApp === 'function' ? getApp().globalData.account?.id : null, version: this.data.remoteDraftVersion };
    const value = String(source[key] || '');
    this.setData({ textEditor: { scope, key, title, max: Number(max) || 1000, index, value, original: value }, navTitle: title }, () => wx.pageScrollTo({ scrollTop: 0, duration: 0 }));
  },
  updateEditorText(event) { if (!this.data.saving && this.data.textEditor) this.setData({ 'textEditor.value': event.detail.value }); },
  closeTextEditor() {
    const parent = this.textParent;
    this.activeKeyboardField = null;
    if (wx.hideKeyboard) wx.hideKeyboard();
    this.setData({ textEditor: null, keyboardInset: 0, navTitle: parent ? parent.title : '管理橱窗' }, () => wx.pageScrollTo({ scrollTop: parent ? parent.scrollTop : 0, duration: 0 }));
    this.textParent = null;
  },
  finishTextEditor() {
    const editor = this.data.textEditor, parent = this.textParent;
    if (this.unloaded || this.data.saving || !editor || !parent) return;
    const source = editor.scope === 'profile' ? this.data.profileDraft : editor.scope === 'service' ? this.data.serviceDrafts[editor.index] : this.data.workDrafts[editor.index];
    if (!source || source.id !== parent.sourceId || (typeof getApp === 'function' ? getApp().globalData.account?.id : null) !== parent.owner || this.data.remoteDraftVersion !== parent.version) return wx.showToast({ title: '内容已更新，请返回重新核对', icon: 'none' });
    const event = { currentTarget: { dataset: { key: editor.key, index: editor.index } }, detail: { value: editor.value } };
    if (editor.scope === 'profile') this.updateProfile(event);
    else if (editor.scope === 'service') this.updateService(event);
    else this.updateWork(event);
    this.closeTextEditor();
  },
  cancelTextEditor() {
    const editor = this.data.textEditor;
    if (!editor) return;
    if (editor.value === editor.original) return this.closeTextEditor();
    this.chooseLeave('完成并返回', () => this.finishTextEditor(), () => this.closeTextEditor());
  },
  focusEditorField(event) {
    if (this.unloaded) return;
    this.activeKeyboardField = event.currentTarget.dataset.field;
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
    if (!this.keyboardWindowHeight) this.keyboardWindowHeight = info && info.windowHeight;
    this.changeEditorKeyboard(event);
  },
  changeEditorKeyboard(event) {
    if (this.unloaded) return;
    const height = Math.max(0, Number(event.detail.height) || 0);
    const available = this.keyboardWindowHeight ? this.keyboardWindowHeight - height - 200 : 176;
    const textEditorHeight = height ? Math.max(88, Math.min(280, available)) : 280;
    this.setData({ keyboardInset: height, textEditorHeight }, () => { if (height) this.revealEditorField(); });
  },
  revealEditorField() {
    const id = this.activeKeyboardField, height = this.data.keyboardInset, windowHeight = this.keyboardWindowHeight;
    if (!id || !height || !windowHeight || !wx.createSelectorQuery) return;
    const sequence = this.keyboardSequence = (this.keyboardSequence || 0) + 1;
    wx.createSelectorQuery().in(this).select('#' + id).boundingClientRect().exec(results => {
      if (this.unloaded || this.editorHidden || sequence !== this.keyboardSequence || id !== this.activeKeyboardField || height !== this.data.keyboardInset) return;
      const rect = results && results[0];
      if (!rect) return;
      const bottom = windowHeight - height - 16;
      const offset = Math.max(0, rect.bottom - bottom);
      if (offset > 0) wx.pageScrollTo({ scrollTop: (this.editorScrollTop || 0) + offset, duration: 0 });
    });
  },

  openAccount() {
    if (this.unloaded || this.data.saving || this.data.cloudLoading || this.data.uploadingImages) return;
    this.accountOpen = true;
    wx.navigateTo({ url: `/pages/account-profile/index?role=provider${this.auditMode ? "&audit=1" : ""}` });
  },
  openCalendar() { if (this.unloaded || this.data.saving || this.data.cloudLoading) return; wx.navigateTo({ url: `/pages/provider-calendar/index${this.auditMode ? "?audit=1" : ""}` }); },
  openSection(event) {
    if (this.confirmPendingEdit(() => this.openSection(event))) return;
    if (this.unloaded || this.data.saving || this.data.cloudLoading || this.data.uploadingImages) return;
    const view = event.currentTarget.dataset.section;
    if (!["profile", "notice"].includes(view)) return;
    this.sectionScrollTop = this.editorScrollTop || 0;
    this.editSnapshot = clone(this.buildDraftValue());
    this.setData({ editorView: view, editorError: "", navTitle: view === "profile" ? "编辑资料" : "合作须知" }, () => wx.pageScrollTo({ scrollTop: 0, duration: 0 }));
  },
  async updateAccepting(event) {
    if (this.unloaded || this.data.saving) return;
    const accepting = Number(event.detail.value) === 0;
    if (!this.data.remoteEnabled) return this.setData({ 'profileDraft.accepting': accepting });
    const owner = getApp().globalData.account?.id;
    this.setData({ saving: true, editorError: '' });
    try {
      const state = await cloudAvailability.getMine();
      if (this.unloaded || getApp().globalData.account?.id !== owner) return;
      await cloudAvailability.saveMine(state.version, null, accepting);
      if (this.unloaded || getApp().globalData.account?.id !== owner) return;
      this.setData({ 'profileDraft.accepting': accepting });
      if (this.savedDraft) this.savedDraft.profile.accepting = accepting;
      if (this.editSnapshot) this.editSnapshot.profile.accepting = accepting;
      cloudCatalog.clearStorefrontState();
      wx.showToast({ title: accepting ? '已开放新预约' : '已暂停新预约', icon: 'none' });
    } catch (_) { if (!this.unloaded) this.setData({ editorError: '接单状态未更新，请重试。已有订单不受影响。' }); }
    finally { if (!this.unloaded) this.setData({ saving: false }); }
  },
  returnToManage() {
    this.editSnapshot = null;
    this.setData({ editorView: "manage", editorError: "", navTitle: this.data.managementTab === "services" ? "服务项目" : this.data.managementTab === "works" ? "作品集" : this.data.managementTab === "check" ? "发布前检查" : "管理橱窗" });
    this.refreshDerived();
    wx.pageScrollTo({ scrollTop: this.sectionScrollTop || 0, duration: 0 });
  },
  cancelSection() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    if (this.associationServiceReturn) return this.returnToWorkAssociation();
    const saved = this.editSnapshot;
    if (saved) {
      this.clearPendingFiles();
      saved.profile.nickname = this.data.accountNickname;
      saved.profile.avatar = this.data.profileDraft.avatar || "";
      this.setData({ career: saved.career, profileDraft: saved.profile, serviceDrafts: saved.services, workDrafts: normalizeWorks(saved.works), pinnedDraft: saved.pinnedWorkIds, noticeImageDraft: saved.noticeImage, noticeImageAssetId: saved.noticeImageAssetId });
    }
    this.returnToManage();
  },
  async persistDraft(previewDraft) {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return false;
    if (this.data.pendingImagePreviews && this.data.pendingImagePreviews.length) { this.setData({ editorError: '请重试或删除未上传图片后再保存。' }); return false; }
    const draft = previewDraft || this.buildDraftValue();
    if (this.savedDraft && JSON.stringify(cloudCatalog.toServerDraft(draft)) === JSON.stringify(cloudCatalog.toServerDraft(this.savedDraft))) return true;
    this.setData({ saving: true, editorError: "" });
    try {
      if (this.data.remoteEnabled) {
        const saved = await cloudCatalog.saveDraft(this.data.remoteDraftVersion, draft);
        if (this.unloaded) return false;
        this.setData({ remoteDraftVersion: saved.version });
      } else wx.setStorageSync("animeMasterCreatorAuditDraft", draft);
      this.pendingCloudAssets = [];
      this.pendingSavedFiles = [];
      this.savedDraft = clone(draft);
      this.setData({ works: clone(draft.works), profile: clone(draft.profile), services: clone(draft.services) });
      return true;
    } catch (error) {
      if (this.unloaded) return false;
      this.setData({ editorError: ["IMAGE_EDITING_UNAVAILABLE", "SERVICE_NAME_REJECTED", "SERVICE_NAME_CHECK_UNAVAILABLE"].includes(error.code) ? error.message : error.code === "VERSION_CONFLICT" ? "草稿已在其他位置更新，请重新加载后再编辑。" : "保存失败，修改已保留，请重试。" });
      return false;
    } finally { if (!this.unloaded) this.setData({ saving: false }); }
  },
  async saveSection() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    if (this.associationServiceReturn) return this.saveAssociatedService();
    if (await this.persistDraft()) {
      const managementTab = this.data.editorView === 'service' ? 'services' : '';
      this.setData({ managementTab });
      this.returnToManage();
      wx.showToast({ title: '草稿已保存，仅自己可见', icon: 'none' });
    }
  },

  finishSavedSection() {
    if (this.unloaded || this.data.saving) return;
    this.setData({ sectionSaveComplete: false, managementTab: "" });
    this.returnToManage();
  },
  continueSavedSection() {
    const saved = this.savedSection;
    if (!saved || this.unloaded || this.data.saving) return;
    this.setData({ sectionSaveComplete: false });
    if (saved.view === "service") this.toggleServiceEditor({ currentTarget: { dataset: { id: saved.id } } });
    else this.openSection({ currentTarget: { dataset: { section: saved.view } } });
  },
  async saveWork() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages || this.data.workSaveComplete) return;
    if (this.data.pendingImagePreviews.length) return wx.showToast({ title: '请重试或删除未上传图片', icon: 'none' });
    const selected = this.data.workDrafts[this.data.selectedWorkIndex];
    if (!canSaveWork(selected)) {
      wx.showToast({ title: "请上传图片并完成作品必填信息", icon: "none" });
      return;
    }
    if (!await this.persistDraft()) return;
    this.requestWorkId = selected.id;
    this.setData({ workSaveComplete: true, isNewWork: false, navTitle: '作品草稿已保存' });
    this.manageSavedWork();
  },

  continueWorkEditing() {
    if (this.unloaded || !this.data.workSaveComplete) return;
    this.setData({ workSaveComplete: false, editing: true, navTitle: '编辑作品' });
  },

  manageSavedWork() {
    if (this.unloaded || !this.data.workSaveComplete) return;
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const origin = pages[pages.length - 2];
    const openManager = () => wx.redirectTo({ url: `/pages/provider-profile/index?edit=1&section=profile${this.auditMode ? '&audit=1' : ''}`,
      fail: () => wx.showToast({ title: '橱窗未能打开，草稿已保存，请重试', icon: 'none' }) });
    if (origin && origin.route === 'pages/provider-profile/index' && origin.data.editorSection !== 'works') {
      if (origin.setData) origin.setData({managementTab:'works',navTitle:'展示案例'});
      wx.navigateBack({ fail: openManager });
    }
    else openManager();
  },

  previewBuyer() {
    wx.navigateTo({ url: `/pages/provider-detail/index?id=${this.serverProviderId || store.CURRENT_PROVIDER_ID}&workspace=provider${this.auditMode ? "&audit=1" : ""}` });
  },

  async previewSelectedWork() {
    if (this.unloaded || this.data.saving || this.data.uploadingImages) return;
    if (!canSaveWork(this.data.selectedWork)) return wx.showToast({ title: "请先完成作品必填信息", icon: "none" });
    if (!this.data.selectedWork || !this.savedDraft) return;
    const saved = this.data.works.some((work) => work.id === this.data.selectedWork.id);
    if (!saved) return wx.showToast({ title: "请先保存作品草稿", icon: "none" });
    const draft = clone(this.savedDraft);
    const providerId = this.serverProviderId || store.CURRENT_PROVIDER_ID;
    storefrontPreviewDraft.stage(Object.assign({}, draft, { providerId }));
    this.previewOpen = true;
    wx.navigateTo({ url: `/pages/work-detail/index?id=${encodeURIComponent(this.data.selectedWork.id)}&providerId=${encodeURIComponent(providerId)}&workspace=provider&preview=storefront${this.auditMode ? "&audit=1" : ""}` });
  }
});
