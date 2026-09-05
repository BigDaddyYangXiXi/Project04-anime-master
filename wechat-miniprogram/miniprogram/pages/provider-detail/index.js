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
    priceText: `￥${work.price}`,
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
  data: { provider: null, selectedServiceIds: [], selectedTotal: 0, availabilityDays: [], reviewCount: 0, navWorkspace: "buyer", providerPreview: false, storefrontDraftPreview: false, publishing: false, previewPublished: false },

  onLoad(options) {
    this.auditMode = options.audit === "1";
    this.providerPreview = options.workspace === "provider";
    this.storefrontDraftPreview = this.providerPreview && options.preview === "storefront";
    this.setData({
      navWorkspace: this.providerPreview ? "provider" : "buyer",
      providerPreview: this.providerPreview,
      storefrontDraftPreview: this.storefrontDraftPreview
    });
    const stagedPreview = this.storefrontDraftPreview ? storefrontPreviewDraft.get() : null;
    if (stagedPreview && String(stagedPreview.providerId) === String(options.id)) {
      const profile = stagedPreview.profile || {};
      this.loadProvider(options, {
        id: stagedPreview.providerId, uid: "", name: profile.nickname || "未命名服务方", career: profile.career || "",
        city: profile.city || "", cityCode: profile.cityCode || "", bio: profile.bio || "", notice: profile.notice || "",
        tags: String(profile.tags || "").split(/[,，]/).filter(Boolean), orders: 0, rating: null, reviewCount: 0, replyHours: null,
        services: stagedPreview.services || [], works: stagedPreview.works || []
      }, stagedPreview);
      return;
    }
    const catalogProvider = findProvider(options.id);
    if (!this.auditMode && !this.storefrontDraftPreview) {
      this.loadCloudProvider(options, options.id);
      return;
    }
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
        wx.showToast({ title: "旧图片迁移失败，请在服务橱窗重新选择", icon: "none" });
      }).then(() => this.loadProvider(options, catalogProvider));
      return;
    }
    this.loadProvider(options, catalogProvider);
  },

  loadCloudProvider(options, providerId) {
    cloudCatalog.getProvider(providerId).then(async ({ provider }) => {
      if (!provider) {
        this.setData({ provider: null });
        wx.showToast({ title: "橱窗尚未发布", icon: "none" });
        return;
      }
      const remoteDraft = {
        profile: {
          nickname: provider.nickname,
          avatar: provider.avatarUrl || "",
          city: provider.city || "",
          cityCode: provider.cityCode || "",
          bio: provider.bio || "",
          notice: provider.notice || "",
          tags: (provider.tags || []).join(",")
        },
        services: (provider.services || []).map((service) => ({
          id: service.id, name: service.name, price: Number(service.priceFen || 0) / 100,
          unit: service.unit, description: service.description,
          workIds: (provider.works || []).filter((work) => work.serviceId === service.id).map((work) => work.id),
          serviceMode: service.serviceMode || "ONSITE", serviceAreas: service.serviceAreas || []
        })),
        works: (provider.works || []).map((work) => ({
          id: work.id, code: work.code, title: work.title, subtitle: work.subtitle,
          price: Number(work.priceFen || 0) / 100, description: work.description,
          tone: work.tone || "coral", tags: work.tags || [], referenceCount: work.referenceCount || 0,
          imageAssetIds: work.imageAssetIds || [], imagePreviews: work.imageUrls || []
        })),
        pinnedWorkIds: provider.pinnedWorkIds || [],
        noticeImage: provider.noticeImageUrl || ""
      };
      const remoteAvailability = await cloudAvailability.getPublic(provider.id);
      this.loadProvider(options, {
        id: provider.id,
        uid: provider.uid,
        name: provider.nickname,
        career: provider.career,
        city: provider.city || "",
        cityCode: provider.cityCode || "",
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
    }).catch(() => {
      this.setData({ provider: null });
      wx.showToast({ title: "云端橱窗读取失败，请重试", icon: "none" });
    });
  },

  loadProvider(options, catalogProvider, remoteDraft = null, remoteAvailability = null) {
    const isCurrent = remoteDraft || catalogProvider.id === store.CURRENT_PROVIDER_ID;
    const stagedDraft = !remoteDraft && isCurrent && this.storefrontDraftPreview ? storefrontPreviewDraft.get() : null;
    const previewDraft = stagedDraft || remoteDraft;
    if (this.storefrontDraftPreview && !previewDraft) {
      this.storefrontDraftPreview = false;
      this.setData({ storefrontDraftPreview: false });
      wx.showToast({ title: "预览草稿已失效，已显示当前橱窗", icon: "none" });
    }
    const profile = previewDraft ? previewDraft.profile : isCurrent ? store.getProfile() : null;
    const baseWorks = previewDraft ? previewDraft.works : isCurrent ? store.getWorks() : catalogProvider.works;
    const baseServices = previewDraft ? previewDraft.services : isCurrent ? store.getServices() : catalogProvider.services;
    const displayProvider = Object.assign({}, catalogProvider, isCurrent ? {
      name: profile.nickname,
      avatar: profile.avatar || "",
      career: profile.career || catalogProvider.career,
      city: profile.city,
      cityCode: profile.cityCode || "",
      bio: profile.bio,
      tags: profile.tags.split(/[、,，]/).filter(Boolean),
      notice: profile.notice
    } : {});
    const pinnedWorkIds = previewDraft ? previewDraft.pinnedWorkIds : isCurrent ? store.getPinnedWorkIds() : [];
    const works = buildWorks(sortPinnedWorks(baseWorks, pinnedWorkIds), displayProvider);
    const requestedServiceIds = options.services ? decodeURIComponent(options.services).split(",").filter(Boolean) : null;
    const expandedServiceId = options.expanded ? decodeURIComponent(options.expanded) : "";
    const discoveryContext = this.providerPreview ? null : getDiscoveryContext();
    let firstAvailableSelected = false;
    const services = baseServices.map((service) => {
      const linkedWorks = works.filter((work) => (service.workIds || []).includes(work.id));
      const availableInCity = !discoveryContext || serviceSupportsCity(service, displayProvider, discoveryContext.cityCode);
      const selected = availableInCity && (requestedServiceIds ? requestedServiceIds.includes(service.id) : !firstAvailableSelected);
      if (selected) firstAvailableSelected = true;
      return Object.assign({}, service, {
        priceText: `￥${service.price} / ${service.unit}`,
        selected,
        availableInCity,
        locationText: serviceLocationText(service, displayProvider, discoveryContext),
        expanded: service.id === expandedServiceId,
        coverWork: linkedWorks[0] || null,
        galleryWorks: linkedWorks.length >= 4 ? linkedWorks.slice(0, 4) : linkedWorks.length >= 3 ? linkedWorks.slice(0, 3) : linkedWorks.slice(0, 1)
      });
    });
    const availableDays = remoteDraft ? [] : isCurrent ? store.getAvailableDays() : (availability[catalogProvider.id] || { available: [] }).available;
    const selectedServices = services.filter((service) => service.selected);
    const selectedServiceIds = selectedServices.map((service) => service.id);
    const reviewCount = remoteDraft ? Number(catalogProvider.reviewCount || 0) : store.getOrders().filter((order) => order.rating && order.providerId === catalogProvider.id).length;
    this.setData({
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
      selectedTotal: selectedServices.reduce((sum, service) => sum + service.price, 0),
      availabilityDays: remoteAvailability ? calendarModel.upcoming(remoteAvailability.openDates, remoteAvailability.lockedDates) : remoteDraft ? calendarModel.upcoming([], []) : buildAvailability(catalogProvider.id, availableDays),
      reviewCount,
      noticeImage: previewDraft ? previewDraft.noticeImage : isCurrent ? store.getNoticeImage() : ""
    });
  },

  confirmPublish() {
    if (!this.data.storefrontDraftPreview || this.data.publishing || this.data.previewPublished) return;
    const draft = storefrontPreviewDraft.get();
    const expectedProviderId = this.data.provider && this.data.provider.id;
    if (!draft || String(draft.providerId) !== String(expectedProviderId)) {
      this.setData({ storefrontDraftPreview: false });
      wx.showToast({ title: "预览草稿已失效，请返回重新保存", icon: "none" });
      return;
    }
    this.setData({ publishing: true });
    if (!this.auditMode && Number.isSafeInteger(draft.draftVersion)) {
      cloudCatalog.publishDraft(draft.draftVersion).then(() => {
        this.finishPublish(draft);
      }).catch((error) => {
        this.setData({ publishing: false });
        const messages = {
          MEDIA_NOT_READY: "作品图片仍在安全审核中，请稍后发布",
          VERSION_CONFLICT: "草稿已更新，请返回重新预览",
          PUBLISH_CONFLICT: "橱窗发布状态已变化，请重试",
          PUBLISH_VALIDATION_FAILED: "橱窗资料不完整，请返回补充"
        };
        wx.showToast({ title: messages[error.code] || "发布失败，请重试", icon: "none" });
      });
      return;
    }
    this.finishPublish(draft);
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
      storefrontPreviewDraft.markPublished();
      this.setData({ publishing: false, previewPublished: true });
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

  openWork(event) {
    const id = event.detail && event.detail.id ? event.detail.id : event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/work-detail/index?id=${id}&source=B02${this.providerPreview ? "&workspace=provider" : ""}${this.storefrontDraftPreview ? "&preview=storefront" : ""}` });
  },

  openSchedule() {
    wx.navigateTo({ url: `/pages/provider-schedule/index?id=${this.data.provider.id}&source=B02${this.providerPreview ? "&workspace=provider" : ""}` });
  },

  startBooking() {
    if (this.providerPreview) return wx.showToast({ title: "橱窗预览中不可发起预约", icon: "none" });
    if (!this.data.selectedServiceIds.length) return;
    wx.navigateTo({
      url: `/pages/booking/index?providerId=${this.data.provider.id}&services=${encodeURIComponent(this.data.selectedServiceIds.join(","))}`
    });
  }
});
