const creatorProfile = require("../../data/creator-profile");
const cloudSavedItems = require("../../services/cloud-saved-items");
const localPreview = require("../../utils/local-preview");
const { findProvider } = require("../../data/catalog");
const store = require("../../data/v063-store");
const storefrontPreviewDraft = require("../../data/storefront-preview-draft");
const { availability } = require("../../data/v063");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudAvailability = require("../../services/cloud-availability");
const calendarModel = require("../../data/calendar-model");
const { getDiscoveryContext } = require("../../data/discovery-context");

const weekdayLabels = ["今天", "周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function buildAvailability(providerId, availableDays) {
  const fullDays = (availability[providerId] || { full: [] }).full;
  return Array.from({ length: 8 }, (_, index) => {
    const day = 16 + index;
    const state = fullDays.includes(day) ? "full" : availableDays.includes(day) ? "open-all" : "unknown";
    return { day, weekday: weekdayLabels[index], state };
  });
}

function buildWorks(works, provider) {
  return works.map((work) => Object.assign({}, work, {
    priceText: work.price == null ? "" : `￥${work.price}`,
    coverImage: (work.imagePreviews || [])[0] || "",
    provider: { id: provider.id, name: provider.name, initial: provider.name.slice(0, 1) }
  }));
}

function sortPinnedWorks(works, pinnedIds) {
  const pinnedOrder = new Map(pinnedIds.map((id, index) => [id, index]));
  return works.slice().sort((left, right) => {
    const leftIndex = pinnedOrder.has(left.id) ? pinnedOrder.get(left.id) : Number.MAX_SAFE_INTEGER;
    const rightIndex = pinnedOrder.has(right.id) ? pinnedOrder.get(right.id) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function serviceSupportsCity(service, provider, cityCode) {
  const mode = service.serviceMode || "ONSITE";
  if (mode === "ONLINE" || mode === "BOTH") return true;
  return provider.cityCode === cityCode || (service.serviceAreas || []).some((area) => area.cityCode === cityCode);
}

function serviceLocationText(service, provider, region) {
  const mode = service.serviceMode || "ONSITE";
  if (!region) return mode === "ONLINE" ? "线上服务" : mode === "BOTH" ? "支持到场或线上" : `常驻地${provider.city}服务`;
  const local = provider.cityCode === region.cityCode;
  const covered = (service.serviceAreas || []).some((area) => area.cityCode === region.cityCode);
  if (mode === "ONLINE") return "线上服务";
  if (mode === "BOTH") return local || covered ? "当前城市可到场，也可线上" : "当前城市仅支持线上";
  return local ? "常驻城市到场服务" : covered ? "覆盖当前城市到场服务" : `暂不覆盖${region.city}`;
}

Page({
  data: { readingPage:"", calendarLoading:false, calendarError:"", calendarKnown:false, calendarOffset:0, calendarDays:[], calendarWeekdays:["一","二","三","四","五","六","日"], publicationFlow:false, publicationUnknown:false, intentChecked:false, serviceDetail:null, loading: false, loadError: "", socialLoadError: "", preferencesOpen: false, noticeOpen: false, profileTab: "works", provider: null, selectedServiceIds: [], selectedTotal: 0, availabilityDays: [], reviewCount: 0, navWorkspace: "buyer", providerPreview: false, storefrontDraftPreview: false, publishing: false, publishError: "", publishQueued: false, previewPublished: false },

  onLoad(options) {
    this.unloaded = false;
    this.publicationEntry = options.publication || '';
    this.setData({publicationFlow:!!this.publicationEntry});
    const requestId = this.providerRequestId = (this.providerRequestId || 0) + 1;
    this.socialRequestId = (this.socialRequestId || 0) + 1;
    this.setData({ socialPending: false });
    this.auditMode = localPreview.isAudit(options);
    this.providerPreview = options.workspace === "provider";
    this.storefrontDraftPreview = this.providerPreview && options.preview === "storefront";
    this.setData({
      profileTab: options.expanded || options.services ? "services" : "works",
      navWorkspace: this.providerPreview ? "provider" : "buyer",
      providerPreview: this.providerPreview,
      storefrontDraftPreview: this.storefrontDraftPreview,
      visitorDraftPreview: this.storefrontDraftPreview && options.visitor === "1"
    });
    const stagedPreview = this.storefrontDraftPreview ? storefrontPreviewDraft.get() : null;
    const previewOwner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    if (stagedPreview && String(stagedPreview.providerId) === String(options.id) && (this.auditMode || String(stagedPreview.providerId) === String(previewOwner))) {
      const profile = stagedPreview.profile || {};
      this.loadProvider(options, {
        ...(stagedPreview.statistics || {}),
        id: stagedPreview.providerId, uid: profile.uid || (stagedPreview.statistics || {}).uid || "", name: profile.nickname || "未命名服务方", career: profile.career || "",
        city: profile.city || "", cityCode: profile.cityCode || "", bio: profile.bio || "", notice: profile.notice || "",
        tags: String(profile.tags || "").split(/[,，]/).filter(Boolean),
        services: stagedPreview.services || [], works: stagedPreview.works || []
      }, stagedPreview);
      if (this.publicationEntry === 'submit') this.confirmPublish();
      return;
    }
    if (!this.auditMode && this.storefrontDraftPreview) {
      this.storefrontDraftPreview = false;
      this.setData({ storefrontDraftPreview: false, visitorDraftPreview: false, publicationFlow: false });
    }
    if (!this.auditMode && !this.storefrontDraftPreview) {
      this.loadCloudProvider(options, options.id);
      return;
    }
    const catalogProvider = findProvider(options.id);
    if (!catalogProvider) {
      wx.showToast({ title: "没有找到服务者", icon: "none" });
      return;
    }
    if (catalogProvider.id === store.CURRENT_PROVIDER_ID && !this.auditMode) {
      if (this.storefrontDraftPreview) {
        this.loadProvider(options, catalogProvider);
        return;
      }
    }
    if (catalogProvider.id === store.CURRENT_PROVIDER_ID) {
      const migration = store.migrateLegacyMedia();
      if (!migration) {
        this.loadProvider(options, catalogProvider);
        return;
      }
      migration.catch(() => {
        if (requestId !== this.providerRequestId) return;
        wx.showToast({ title: "旧图片迁移失败，请在服务橱窗重新选择", icon: "none" });
      }).then(() => { if (requestId === this.providerRequestId) this.loadProvider(options, catalogProvider); });
      return;
    }
    this.loadProvider(options, catalogProvider);
  },

  loadCloudProvider(options, providerId) {
    if (this.unloaded) return;
    this.providerLoadOptions = { ...options, id: providerId };
    this.setData({ loading: true, loadError: "" });
    const requestId = this.providerRequestId = (this.providerRequestId || 0) + 1;
    return cloudCatalog.getProvider(providerId).then(async ({ provider }) => {
      if (requestId !== this.providerRequestId) return;
      if (!provider) {
        this.setData({ provider: null, loading: false });
        return;
      }
      const remoteDraft = {
        profile: {
          nickname: provider.nickname,
          avatar: provider.avatarUrl || "",
          city: provider.city || "",
          cityCode: provider.cityCode || "",
          district: provider.district || "", accepting: provider.accepting !== false, specialties: provider.specialties || "", declines: provider.declines || "", contactHours: provider.contactHours || "",
          bio: provider.bio || "",
          notice: provider.notice || "",
          tags: (provider.tags || []).join(",")
        },
        services: (provider.services || []).map((service) => ({
          id: service.id, name: service.name, price: Number(service.priceFen || 0) / 100,
          unit: service.unit, description: service.description,
          workIds: (provider.works || []).filter((work) => work.serviceId === service.id).map((work) => work.id),
          includes: service.includes || "", extras: service.extras || "", preparation: service.preparation || "",
          serviceMode: service.serviceMode || "ONSITE", serviceAreas: service.serviceAreas || []
        })),
        works: (provider.works || []).map((work) => ({
          id: work.id, code: work.code, title: work.title, subtitle: work.subtitle,
          price: work.priceFen == null ? null : Number(work.priceFen) / 100, description: work.description,
          tone: work.tone || "coral", tags: work.tags || [], referenceCount: work.referenceCount || 0,
          imageAssetIds: work.imageAssetIds || [], imagePreviews: work.imageUrls || []
        })),
        pinnedWorkIds: provider.pinnedWorkIds || [],
        noticeImage: provider.noticeImageUrl || ""
      };
      const remoteAvailability = await cloudAvailability.getPublic(provider.id);
      if (requestId !== this.providerRequestId) return;
      this.loadProvider(options, {
        id: provider.id,
        uid: provider.uid,
        reviews: provider.reviews || [],
        name: provider.nickname,
        career: provider.career,
        city: provider.city || "",
        cityCode: provider.cityCode || "",
        district: provider.district || "", accepting: provider.accepting !== false, specialties: provider.specialties || "", declines: provider.declines || "", contactHours: provider.contactHours || "",
          bio: provider.bio || "",
        notice: provider.notice || "",
        tags: provider.tags || [],
        orders: Number(provider.orders || 0),
        rating: provider.rating == null ? null : Number(provider.rating),
        reviewCount: Number(provider.reviewCount || 0),
        averageResponseMinutes: provider.averageResponseMinutes == null ? null : Number(provider.averageResponseMinutes),
        responseSampleCount: Number(provider.responseSampleCount || 0),
        replyHours: provider.averageResponseMinutes == null ? null : Math.round(Number(provider.averageResponseMinutes) / 6) / 10
      }, remoteDraft, remoteAvailability);
      this.setData({ loading: false });
    }).catch(() => {
      if (requestId !== this.providerRequestId) return;
      this.setData({ provider: null, loading: false, loadError: "橱窗读取失败，请重试。" });
    });
  },

  retryLoad() {
    if (this.unloaded || this.data.loading || !this.providerLoadOptions) return;
    return this.loadCloudProvider(this.providerLoadOptions, this.providerLoadOptions.id);
  },

  onHide() { this.intentHidden = true; clearTimeout(this.intentTimer); },
  onUnload() {
    clearTimeout(this.intentTimer);
    this.unloaded = true;
    this.providerRequestId = (this.providerRequestId || 0) + 1;
    this.socialRequestId = (this.socialRequestId || 0) + 1;
    this.publishRequestId = (this.publishRequestId || 0) + 1;
  },

  loadProvider(options, catalogProvider, remoteDraft = null, remoteAvailability = null) {
    const isCurrent = remoteDraft || catalogProvider.id === store.CURRENT_PROVIDER_ID;
    const stagedDraft = !remoteDraft && isCurrent && this.storefrontDraftPreview ? storefrontPreviewDraft.get() : null;
    const previewDraft = stagedDraft || remoteDraft;
    this.publicationDraft = this.storefrontDraftPreview && previewDraft ? JSON.parse(JSON.stringify(previewDraft)) : null;
    if (!this.auditMode && this.publicationDraft && this.data.publicationFlow && this.publicationEntry !== 'submit') {
      let task; try { task = wx.getStorageSync("animeMasterPublicationIntentV1"); } catch (_) {}
      if (task && String(task.owner) === String(getApp().globalData.account?.id) && task.version === this.publicationDraft.draftVersion && Date.now() >= task.at && Date.now() - task.at < 86400000) {
        this.publicationIntent = task; this.intentAttempts = 0;
        this.setData({ publishQueued: true }); this.refreshPublicationIntent();
      } else {
        this.publicationIntent = { owner: getApp().globalData.account?.id, version: this.publicationDraft.draftVersion };
        this.intentAttempts = 0; this.refreshPublicationIntent();
      }
    }
    if (this.storefrontDraftPreview && !previewDraft) {
      this.storefrontDraftPreview = false;
      this.setData({ storefrontDraftPreview: false });
      wx.showToast({ title: "预览草稿已失效，已显示当前橱窗", icon: "none" });
    }
    const profile = previewDraft ? previewDraft.profile : isCurrent ? store.getProfile() : null;
    const baseWorks = previewDraft ? previewDraft.works : isCurrent ? store.getWorks() : catalogProvider.works;
    const baseServices = previewDraft ? previewDraft.services : isCurrent ? store.getServices() : catalogProvider.services;
    const displayProvider = Object.assign({}, catalogProvider, isCurrent ? {
      district: profile.district || "", accepting: profile.accepting !== false, specialties: profile.specialties || "", declines: profile.declines || "", contactHours: profile.contactHours || "",
      name: profile.nickname,
      avatar: profile.avatar || "",
      bannerImage: profile.bannerImage || "",
      career: profile.career || catalogProvider.career,
      city: profile.city,
      cityCode: profile.cityCode || "",
      bio: profile.bio,
      tags: String(profile.tags || "").split(/[、,，]/).filter(Boolean),
      notice: profile.notice
    } : {});
    const pinnedWorkIds = previewDraft ? previewDraft.pinnedWorkIds : isCurrent ? store.getPinnedWorkIds() : [];
    const works = buildWorks(sortPinnedWorks(baseWorks, pinnedWorkIds), displayProvider);
    const requestedServiceIds = options.services ? decodeURIComponent(options.services).split(",").filter(Boolean) : null;
    const expandedServiceId = options.expanded ? decodeURIComponent(options.expanded) : "";
    const discoveryContext = this.providerPreview ? null : getDiscoveryContext();
    const services = baseServices.map((service) => {
      const linkedWorks = works.filter((work) => (service.workIds || []).includes(work.id));
      const availableInCity = displayProvider.accepting !== false && (!discoveryContext || serviceSupportsCity(service, displayProvider, discoveryContext.cityCode));
      const selected = availableInCity && (requestedServiceIds ? requestedServiceIds.includes(service.id) : false);
      return Object.assign({}, service, {
        serviceModeLabel: ({ONSITE:'到场服务',ONLINE:'线上服务',BOTH:'到场或线上'})[service.serviceMode] || '到场服务',
        priceText: `￥${service.price} / ${service.unit}`,
        selected,
        availableInCity,
        locationText: serviceLocationText(service, displayProvider, discoveryContext),
        expanded: service.id === expandedServiceId,
        coverWork: linkedWorks[0] || null,
        galleryWorks: linkedWorks,
        linkedTitles: linkedWorks.map((work) => work.title).join("、")
      });
    });
    const availableDays = remoteDraft ? [] : isCurrent ? store.getAvailableDays() : (availability[catalogProvider.id] || { available: [] }).available;
    const selectedServices = services.filter((service) => service.selected);
    const selectedServiceIds = selectedServices.map((service) => service.id);
    const reviewCount = remoteDraft ? Number(catalogProvider.reviewCount || 0) : store.getOrders().filter((order) => order.rating && order.providerId === catalogProvider.id).length;
    this.setData({
      creator: creatorProfile.present(displayProvider, Object.assign({}, catalogProvider, { reviewCount })),
      serviceDetail: expandedServiceId ? services.find(service => service.id === expandedServiceId) || null : null,
      provider: Object.assign({}, displayProvider, {
        initial: displayProvider.name.slice(0, 1),
        ratingText: Number.isFinite(displayProvider.rating) ? displayProvider.rating.toFixed(1) : "—",
        replyText: Number.isFinite(displayProvider.averageResponseMinutes)
          ? displayProvider.averageResponseMinutes < 60 ? `${displayProvider.averageResponseMinutes} 分钟` : `${Math.round(displayProvider.averageResponseMinutes / 6) / 10} 小时`
          : Number.isFinite(displayProvider.replyHours) ? `${displayProvider.replyHours} 小时` : "暂无数据",
        services,
        works
      }),
      selectedServiceIds,
      followed: (this.followedIds || []).includes(catalogProvider.id),
      selectedTotal: selectedServices.reduce((sum, service) => sum + service.price, 0),
      availabilityDays: remoteAvailability ? calendarModel.upcoming(remoteAvailability.openDates, remoteAvailability.lockedDates) : remoteDraft ? calendarModel.upcoming([], []) : buildAvailability(catalogProvider.id, availableDays),
      reviewCount,
      noticeImage: previewDraft ? previewDraft.noticeImage : isCurrent ? store.getNoticeImage() : ""
    });
  },

  togglePreferences() { this.setData({ readingPage: "preferences" }); wx.pageScrollTo({scrollTop:0,duration:0}); },
  closeReadingPage() { this.setData({readingPage:"",reviewsOpen:false}); },
  backStorefrontPage() { if(this.data.readingPage)this.closeReadingPage(); else this.closeServiceDetail(); },
  openOwnerCalendar() { wx.navigateTo({url:"/pages/provider-calendar/index"}); },
  openNotice() { this.setData({ noticeOpen: true }); },
  closeNotice() { this.setData({ noticeOpen: false }); },
  noop() {},
  openReviews() {
    const reviews = this.auditMode ? store.getOrders().filter((order) => order.providerId === this.data.provider.id && order.stage === "COMPLETED" && order.rating > 0).map((order) => ({ rating: order.rating, text: order.reviewText || "", reply: order.reviewReply || "" })) : this.data.provider.reviews || [];
    this.setData({ readingPage: "reviews", reviewsOpen:false, reviews }); wx.pageScrollTo({scrollTop:0,duration:0});
  },
  closeReviews() { this.setData({ reviewsOpen: false }); },
  async onShow() {
    this.intentHidden = false;
    if (!this.unloaded && this.data.profileTab === "schedule" && this.data.provider) { this.setData({calendarKnown:false}); this.loadStorefrontCalendar(); }
    if (this.data.publishQueued) this.refreshPublicationIntent();
    if (this.unloaded || this.providerPreview || this.data.socialPending) return;
    const requestId = this.socialRequestId = (this.socialRequestId || 0) + 1;
    this.setData({ socialPending: true });
    try {
      const ids = this.auditMode ? wx.getStorageSync("v063-followed-providers") || [] : (await cloudSavedItems.listMine()).providerIds || [];
      if (requestId !== this.socialRequestId) return;
      this.followedIds = ids;
      this.setData({ followed: Boolean(this.data.provider && ids.includes(this.data.provider.id)), socialLoadError: "" });
    } catch {
      if (requestId === this.socialRequestId) this.setData({ socialLoadError: "关注状态读取失败，请重新同步。" });
    } finally {
      if (requestId === this.socialRequestId) this.setData({ socialPending: false });
    }
  },
  retrySocial() {
    if (!this.data.socialLoadError) return;
    return this.onShow();
  },
  async toggleFollow() {
    if (this.unloaded || this.providerPreview || this.data.socialPending || this.data.socialLoadError || !this.data.provider) return;
    const followed = !this.data.followed, id = this.data.provider.id;
    const requestId = this.socialRequestId = (this.socialRequestId || 0) + 1;
    this.setData({ socialPending: true });
    try {
      if (!this.auditMode) await cloudSavedItems.setSaved("PROVIDER", id, followed);
      else {
        const ids = wx.getStorageSync("v063-followed-providers") || [];
        wx.setStorageSync("v063-followed-providers", followed ? Array.from(new Set(ids.concat(id))) : ids.filter((value) => value !== id));
      }
      if (requestId === this.socialRequestId) this.setData({ followed });
    } catch (error) { if (requestId === this.socialRequestId) wx.showToast({ title: "关注状态保存失败，请重试", icon: "none" }); }
    finally { if (requestId === this.socialRequestId) this.setData({ socialPending: false }); }
  },
  editStorefront() { wx.navigateTo({ url: `/pages/provider-profile/index?edit=1${this.auditMode ? "&audit=1" : ""}` }); },
  cancelPublication() {
    if (this.unloaded || this.data.publishing || !this.publicationIntent?.id) return;
    wx.showModal({ title: '撤回本次发布？', content: '草稿会保留，已公开的旧版本不受影响。若检测已完成并公开，会显示真实结果。', confirmText: '撤回发布', success: async ({ confirm }) => {
      if (!confirm || this.unloaded) return;
      this.setData({ publishing: true });
      try {
        const result = await cloudCatalog.cancelPublishIntent(this.publicationIntent.id);
        if (result.status === 'CANCELLED') cloudCatalog.resetPublicationRequest();
        if (this.unloaded) return;
        if (result.status === 'APPLIED') return this.finishPublish(this.publicationDraft);
        clearTimeout(this.intentTimer);
        this.setData({ publishQueued: false, publishError: '本次发布已撤回，草稿保留。修改并保存后可再次提交。' });
      } catch (_) { if (!this.unloaded) this.setData({ publishError: '撤回结果未确认，请刷新核对。' }); }
      finally { if (!this.unloaded) this.setData({ publishing: false }); }
    } });
  },
  showPublishedStorefront() {
    if (!this.data.previewPublished || !this.data.provider) return;
    wx.redirectTo({url:'/pages/provider-detail/index?id='+this.data.provider.id+'&workspace=provider'});
  },
  queryOriginalPublication() {
    if (this.unloaded || this.intentReading || this.data.publishing) return;
    if (!this.publicationIntent && this.publicationDraft) this.publicationIntent = {owner:this.publicationDraft.providerId,version:this.publicationDraft.draftVersion};
    this.intentAttempts=0;this.refreshPublicationIntent();
  },
  openServiceDetail(event) { const service=this.data.provider?.services.find(x=>x.id===event.currentTarget.dataset.id);if(service)this.setData({serviceDetail:{...service,serviceCitiesText:(service.serviceAreas || []).map(area=>area.cityName).join("、") || this.data.provider.city || ""}}); },
  closeServiceDetail() { this.setData({serviceDetail:null}); },
  returnToStorefrontManager() {
    if(this.data.publishing)return;
    const pages=typeof getCurrentPages==='function'?getCurrentPages():[];
    const index=pages.map(p=>p.route).lastIndexOf('pages/provider-profile/index');
    if(index>=0){const manager=pages[index];if(manager.setData)manager.setData({managementTab:'',navTitle:'管理橱窗'});wx.navigateBack({delta:pages.length-index-1});}
    else wx.redirectTo({url:'/pages/provider-profile/index?edit=1&section=profile'});
  },
  continueEditing() { if (this.unloaded || this.data.publishing) return; if(this.data.readingPage)return this.closeReadingPage(); if(this.data.serviceDetail)return this.closeServiceDetail(); wx.navigateBack(); },

  confirmPublish() {
    if (this.unloaded || !this.data.storefrontDraftPreview || this.data.publishing || this.data.publishQueued || this.data.previewPublished) return;
    const draft = storefrontPreviewDraft.get();
    const expectedProviderId = this.data.provider && this.data.provider.id;
    if (!draft || String(draft.providerId) !== String(expectedProviderId) || JSON.stringify(draft) !== JSON.stringify(this.publicationDraft)) {
      this.setData({ publishError: "预览草稿已失效，请返回重新保存" });
      wx.showToast({ title: "预览草稿已失效，请返回重新保存", icon: "none" });
      return;
    }
    if (!this.auditMode && (!Number.isSafeInteger(draft.draftVersion) || draft.draftVersion < 1)) {
      this.setData({ publishError: "预览草稿已失效，请返回重新保存" });
      wx.showToast({ title: "预览草稿已失效，请返回重新保存", icon: "none" });
      return;
    }
    this.setData({ publishing: true, publishError: "", publicationUnknown:false });
    if (!this.auditMode) {
      const requestId = this.publishRequestId = (this.publishRequestId || 0) + 1;
      cloudCatalog.publishDraft(draft.draftVersion).then((result) => {
        if (requestId !== this.publishRequestId || String(getApp().globalData.account?.id) !== String(draft.providerId)) return;
        if (result?.queued) {
          this.publicationIntent = { id: result.intentId, owner: draft.providerId, version: draft.draftVersion };
          try { wx.setStorageSync("animeMasterPublicationIntentV1", { ...this.publicationIntent, at: Date.now() }); } catch (_) {}
          this.setData({ publishing: false, publishQueued: true });
          this.intentAttempts = 0; this.refreshPublicationIntent(); return;
        }
        if (result.status && result.status !== 'APPLIED') {
          cloudCatalog.resetPublicationRequest();
          this.setData({ publishing: false, publishQueued: false, publishError: '本次任务未公开，请核对内容后重新提交。' });
          return;
        }
        this.finishPublish(draft);
      }).catch((error) => {
        if (requestId !== this.publishRequestId || String(getApp().globalData.account?.id) !== String(draft.providerId)) return;
        this.setData({ publishing: false });
        const messages = {
          PROVIDER_NOT_QUALIFIED: "发布规则尚未同步，请稍后重试；无需申请入驻审核。",
          PROVIDER_NOT_AVAILABLE: "当前账号暂不能公开橱窗，请联系平台处理。",
          SERVICE_NAME_REJECTED: "公开文字未通过内容检测，请检查资料、服务和作品文字后再提交。",
          SERVICE_NAME_CHECK_UNAVAILABLE: "文字检测暂不可用，草稿仍保留，请稍后重试。",
          MEDIA_NOT_READY: "作品图片仍在安全审核中，请稍后发布",
          VERSION_CONFLICT: "草稿已更新，请返回重新预览",
          PUBLISH_CONFLICT: "橱窗发布状态已变化，请重试",
          PUBLISH_VALIDATION_FAILED: "橱窗资料不完整，请返回补充"
        };
        const publicationUnknown = !messages[error.code];
        const publishError = messages[error.code] || "发布结果待确认，请先查询原任务。";
        this.setData({ publishError, publicationUnknown });
        wx.showToast({ title: publishError, icon: "none" });
      });
      return;
    }
    this.finishPublish(draft);
  },

  async refreshPublicationIntent() {
    if (this.unloaded || this.intentHidden || this.intentReading || !this.publicationIntent) return;
    const task = this.publicationIntent;
    if (String(getApp().globalData.account?.id) !== String(task.owner)) return;
    this.intentReading = true;
    try {
      const result = await cloudCatalog.getPublishIntent(task.id, task.version);
      if (this.unloaded || this.publicationIntent !== task || String(getApp().globalData.account?.id) !== String(task.owner)) return;
      this.setData({intentChecked:true, publicationUnknown:false});
      if (!result) return;
      if (result?.status === "APPLIED") {
        this.setData({ publishQueued: false }); this.finishPublish(this.publicationDraft); return;
      }
      if (["PENDING", "STAGED"].includes(result?.status)) {
        task.id = result.id || task.id;
        this.setData({ publishQueued: true });
      }
      if (["FAILED", "SUPERSEDED", "EXPIRED", "CANCELLED"].includes(result?.status)) {
        cloudCatalog.resetPublicationRequest();
        this.setData({ publishQueued: false, publishError: result.status === "SUPERSEDED" ? "内容已有更新，请重新保存并预览后发布。" : "本次内容未发布，请返回编辑页核对图片检测结果。" }); return;
      }
      } catch (_) { if (!this.unloaded && this.publicationIntent === task && String(getApp().globalData.account?.id) === String(task.owner)) this.setData({publicationUnknown:true, publishError:'连接中断，请查询原任务状态，不要重复提交。'}); }
    finally { this.intentReading = false; }
    if (!this.unloaded && !this.intentHidden && ++this.intentAttempts < 6) this.intentTimer = setTimeout(() => this.refreshPublicationIntent(), 5000);
  },
  finishPublish(draft) {
    try {
      if (this.auditMode) {
        store.saveProfile(draft.profile);
        store.saveServices(draft.services);
        store.saveWorks(draft.works);
        store.savePinnedWorkIds(draft.pinnedWorkIds);
        store.saveNoticeImage(draft.noticeImage);
      }
      if (JSON.stringify(storefrontPreviewDraft.get()) === JSON.stringify(draft)) storefrontPreviewDraft.markPublished();
      this.setData({ publishing: false, previewPublished: true, publishError: "" });
      wx.showToast({ title: "橱窗已发布", icon: "success" });
    } catch (error) {
      this.setData({ publishing: false });
      wx.showToast({ title: "发布失败，请重试", icon: "none" });
    }
  },

  refreshSelection(services) {
    const selected = services.filter((service) => service.selected);
    this.setData({
      provider: Object.assign({}, this.data.provider, { services }),
      selectedServiceIds: selected.map((service) => service.id),
      selectedTotal: selected.reduce((sum, service) => sum + service.price, 0)
    });
  },

  chooseProfileTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (["works", "services", "notice", "schedule"].includes(tab)) { this.setData({ profileTab: tab }); if(tab === "schedule" && !this.data.calendarKnown)this.loadStorefrontCalendar(); }
  },

  async loadStorefrontCalendar() {
    if(this.unloaded || this.data.calendarLoading || !this.data.provider)return;
    const id=this.data.provider.id, owner=getApp().globalData.account?.id;
    const request=this.calendarRequest=(this.calendarRequest||0)+1;
    this.setData({calendarLoading:true,calendarError:""});
    try {
      const value=await (this.providerPreview && String(owner)===String(id) ? cloudAvailability.getMine() : cloudAvailability.getPublic(id));
      if(this.unloaded || request!==this.calendarRequest || owner!==getApp().globalData.account?.id || id!==this.data.provider?.id)return;
      this.storefrontCalendar=value;
      this.setData({calendarLoading:false,calendarKnown:true});this.renderStorefrontCalendar();
    } catch(error) {
      if(!this.unloaded && request===this.calendarRequest && owner===getApp().globalData.account?.id && id===this.data.provider?.id)this.setData({calendarLoading:false,calendarError:"档期读取失败，请重试。"});
    }
  },
  renderStorefrontCalendar() {
    if(!this.storefrontCalendar)return;
    const now=new Date();now.setDate(1);now.setMonth(now.getMonth()+this.data.calendarOffset);
    const month=calendarModel.monthFrom(null,now);
    this.setData({calendarTitle:month.title,calendarDays:calendarModel.buildMonth({...month,...this.storefrontCalendar})});
  },
  changeStorefrontMonth(event) {
    const offset=this.data.calendarOffset+Number(event.currentTarget.dataset.step);
    if(!this.data.calendarKnown || offset<0 || offset>11)return;
    this.setData({calendarOffset:offset});this.renderStorefrontCalendar();
  },
  toggleService(event) {
    const id = event.currentTarget.dataset.id;
    const services = this.data.provider.services.map((service) => service.id === id && service.availableInCity !== false ? Object.assign({}, service, { selected: !service.selected }) : service);
    this.refreshSelection(services);
  },

  toggleExpand(event) {
    const id = event.currentTarget.dataset.id;
    const services = this.data.provider.services.map((service) => service.id === id ? Object.assign({}, service, { expanded: !service.expanded }) : service);
    this.setData({ provider: Object.assign({}, this.data.provider, { services }) });
  },
  toggleServiceInfo(event) { this.toggleExpand(event); },

  openWork(event) {
    const id = event.detail && event.detail.id ? event.detail.id : event.currentTarget.dataset.id;
    const provider = this.data.provider;
    const owner = provider && provider.id ? `&providerId=${encodeURIComponent(provider.id)}` : "";
    wx.navigateTo({ url: `/pages/work-detail/index?id=${encodeURIComponent(id)}${owner}&source=B02${this.providerPreview ? "&workspace=provider" : ""}${this.storefrontDraftPreview ? "&preview=storefront" : ""}` });
  },

  openSchedule() {
    wx.navigateTo({ url: `/pages/provider-schedule/index?id=${this.data.provider.id}&source=B02${this.providerPreview ? "&workspace=provider" : ""}` });
  },

  startBooking() {
    if (this.providerPreview) return wx.showToast({ title: "本人预览仅核对服务，不能向自己预约", icon: "none" });
    if (this.data.provider.accepting === false) return wx.showToast({ title: "创作者已暂停接单", icon: "none" });
    if (!this.data.selectedServiceIds.length) { wx.pageScrollTo({ selector: "#storefront-services", duration: 200 }); return; }
    wx.navigateTo({
      url: `/pages/booking/index?providerId=${this.data.provider.id}&services=${encodeURIComponent(this.data.selectedServiceIds.join(","))}${this.auditMode ? "&audit=1" : ""}`,
      fail: () => wx.showToast({ title: "预约页面打开失败，请重试", icon: "none" })
    });
  }
});
