const screenPerformance = require("../../utils/screen-performance");
const displayCache = require("../../utils/display-cache");
const discoveryControls = require("../../data/discovery-controls");
const localPreview = require("../../utils/local-preview");
const { providers, filterOptions, allWorks } = require("../../data/catalog");
const store = require("../../data/v063-store");
const { providers: serviceProviders, stageLabels, stageFlows, matchesFilters, availability } = require("../../data/v063");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudOrders = require("../../services/cloud-orders");
const cloudAccount = require("../../services/cloud-account");
const calendarModel = require("../../data/calendar-model");
const { loadDiscoveryPage } = require("../../utils/discovery-pagination");
const { locationPreference, pickerRegion, regionLabel } = require("../../utils/discovery-region");
const { setDiscoveryContext } = require("../../data/discovery-context");

const PRIORITY_STAGES = ["REQUESTED", "SUPPLEMENTED", "CONTACTING", "NDA_PROVIDER_PENDING", "REVISION_REQUESTED"];
const PRIORITY_PREVIEW_LIMIT = 5;
const LOCATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_REGION_KEY = "animeMasterPreviewRegion";

function countFlow(orders, flow) {
  return orders.filter((order) => stageFlows[flow].includes(order.stage)).length;
}

const homePreferences = require("../../data/home-preferences");
const careerTabs = homePreferences.careers;

const initialDiscovery = {
  妆娘: { query: "", filters: [], recent: ["男角", "伤效妆", "古风"] },
  毛娘: { query: "", filters: [], recent: ["复杂造型", "长发", "古风"] },
  摄影: { query: "", filters: [], recent: ["夜景", "剧情感", "棚拍"] },
  后期: { query: "", filters: [], recent: ["短视频", "氛围调色", "赛博特效"] }
};

const weekdayLabels = ["今天", "周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const calendarWeekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function buildAvailability(providerId) {
  const source = availability[providerId] || { available: [], full: [] };
  return Array.from({ length: 8 }, (_, index) => {
    const day = 16 + index;
    const state = source.full.includes(day) ? "full" : source.available.includes(day) ? "open-all" : "unknown";
    return { day, weekday: weekdayLabels[index], state };
  });
}

function buildProvider(provider) {
  return Object.assign({}, provider, {
    initial: provider.name.slice(0, 1),
    priceText: `￥${provider.services[0] ? provider.services[0].price : 0}`,
    topTags: provider.tags.slice(0, 2),
    miniWorks: provider.works.slice(0, 3).map(work => ({ ...work, coverImage: work.coverImage || (work.imagePreviews || [])[0] || "" })),
    availabilityDays: buildAvailability(provider.id),
    ratingText: Number.isFinite(provider.rating) ? `${provider.rating.toFixed(1)} / 5` : "暂无评分"
  });
}

function buildCloudAvailability(date, state) {
  const first = new Date(`${date}T00:00:00`);
  if (Number.isNaN(first.getTime())) return [];
  return Array.from({ length: 8 }, (_, index) => {
    const current = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    return { day: current.getDate(), weekday: index === 0 ? "所选" : calendarWeekdays[current.getDay()], state: index === 0 && state === "OPEN" ? "open-all" : "unknown" };
  });
}

function buildWork(entry) {
  return Object.assign({}, entry, {
    listKey: `${entry.provider.id}:${entry.id}`,
    priceText: entry.price == null ? "" : `￥${entry.price}`,
    provider: Object.assign({}, entry.provider, { initial: entry.provider.name.slice(0, 1) })
  });
}

Page({
  discovery: JSON.parse(JSON.stringify(initialDiscovery)),

  data: {
    navigationHeight: 0,
    role: "buyer",
    careerTabs,
    career: "妆娘",
    city: "",
    locationLabel: "",
    cityCode: "",
    regionValue: [],
    locationState: "manual",
    locationMessage: "选择服务城市后，为你展示当地可合作的人与作品",
    date: "",
    mode: "works",
    searchOpen: false,
    searchDraft: "",
    searchQuery: "",
    recent: initialDiscovery.妆娘.recent,
    filterOpen: false,
    selectedFilters: [],
    filterDraft: [],
    filterKind: "style",
    styleActive: false,
    priceActive: false,
    availableFilterGroups: [],
    visibleWorks: [],
    visibleProviders: [],
    profile: null,
    profileInitial: "",
    providerCareer: "",
    providerVisibilityText: "",
    storefrontPublished: null,
    metrics: [],
    priorityOrders: [],
    priorityTotal: 0,
    remainingPriority: 0,
    overview: [],
    dashboardLoading: false,
    dashboardError: "",
    catalogLoading: false,
    catalogError: ""
  },

  onNavigationLayout(event) {
    this.setData({ navigationHeight: event.detail.totalHeight });
  },

  onLoad(options) {
    this.unloaded = false;
    this.auditMode = localPreview.isAudit(options);
    this.marketProviders = this.auditMode ? providers : [];
    this.marketWorks = this.auditMode ? allWorks() : [];
    const requestedCareer = options.career ? decodeURIComponent(options.career) : "";
    this.explicitCareer = Boolean(requestedCareer);
    const orderedTabs = homePreferences.tabs();
    this.careerOrder = orderedTabs.map(item => item.name).join("|");
    const career = careerTabs.some((item) => item.name === requestedCareer) ? requestedCareer : orderedTabs[0].name;
    const mode = options.mode === "people" ? "people" : "works";
    const selectedFilters = options.filters ? decodeURIComponent(options.filters).split("|").filter(Boolean) : [];
    const filterDraft = options.filterDraft ? decodeURIComponent(options.filterDraft).split("|").filter(Boolean) : selectedFilters.slice();
    const searchQuery = options.q ? decodeURIComponent(options.q) : "";
    const previewRegion = this.auditMode && localPreview.isLocal()
      ? locationPreference(wx.getStorageSync(PREVIEW_REGION_KEY), LOCATION_MAX_AGE_MS) : null;
    const initialRegion = previewRegion || (this.auditMode
      ? { provinceName: "浙江省", cityName: "杭州", districtName: "", cityCode: "330100" }
      : locationPreference(cloudAccount.peekDiscoveryPreference(), LOCATION_MAX_AGE_MS));
    this.discovery[career] = Object.assign({}, this.discovery[career], { query: searchQuery, filters: selectedFilters });
    this.setData({
      career, careerTabs: orderedTabs,
      city: initialRegion ? initialRegion.cityName : "",
      locationLabel: initialRegion ? regionLabel(initialRegion) : "",
      cityCode: initialRegion ? initialRegion.cityCode : "",
      regionValue: initialRegion ? [initialRegion.provinceName, initialRegion.cityName, initialRegion.districtName || ""] : [],
      locationState: initialRegion ? "ready" : "manual",
      locationMessage: initialRegion ? "" : "选择服务城市后，为你展示当地可合作的人与作品",
      date: this.auditMode ? "2026-08-16" : calendarModel.todayKey(),
      mode,
      searchQuery,
      searchDraft: searchQuery,
      recent: this.discovery[career].recent.slice(),
      selectedFilters,
      filterDraft,
      searchOpen: options.overlay === "search",
      filterOpen: options.overlay === "filter"
    }, () => {
      this.refreshFilterGroups();
      if (this.auditMode) this.refreshResults();
    });
  },

  onShow() {
    if (!this.auditMode && !this.dateManuallySelected) {
      const today = calendarModel.todayKey();
      if (this.data.date !== today) {
        this.setData({ date: today });
        this.cloudCatalogLoaded = false;
        setDiscoveryContext({ city: this.data.city, cityCode: this.data.cityCode, date: today });
      }
    }
    const sessionShowId = this.sessionShowId = (this.sessionShowId || 0) + 1;
    const app = typeof getApp === 'function' ? getApp() : null;
    if (!this.auditMode && app && app.sessionRestoring && app.sessionReady) {
      return app.sessionReady.then(session => {
        if (session.registered && sessionShowId === this.sessionShowId) this.onShow();
      }).catch(() => {});
    }
    this.dashboardRequestId = (this.dashboardRequestId || 0) + 1;
    const role = wx.getStorageSync("animeMasterRole") === "provider" ? "provider" : "buyer";
    this.setData({ role });
    this.syncNativeTabBar(role);
    if (role === "provider") {
      const returning = this.storefrontReturn;
      this.storefrontReturn = null;
      if (returning && returning.owner && returning.owner === app?.globalData.account?.id && returning.revision === displayCache.revision()
        && Date.now() - returning.at >= 0 && Date.now() - returning.at < 15 * 60 * 1000
        && !this.data.dashboardLoading && !this.data.dashboardError && this.dashboardOwner === returning.owner) return;
      this.regionRequestId = (this.regionRequestId || 0) + 1;
      this.discoveryRegionSaving = false;
      this.discoveryInitializationId = (this.discoveryInitializationId || 0) + 1;
      this.discoveryInitializing = false;
      this.catalogRequestId = (this.catalogRequestId || 0) + 1;
      this.loadProviderDashboard();
      return;
    }
    const orderedTabs = homePreferences.tabs(), careerOrder = orderedTabs.map(item => item.name).join("|");
    if (careerOrder !== this.careerOrder) {
      this.careerOrder = careerOrder;
      const career = this.explicitCareer ? this.data.career : orderedTabs[0].name, state = this.discovery[career];
      this.setData({careerTabs: orderedTabs, career, mode: "works", searchQuery: "", searchDraft: "", selectedFilters: [], filterDraft: [], recent: state.recent.slice()});
      this.cloudCatalogLoaded = false; this.refreshFilterGroups();
    }
    this.explicitCareer = false;
    if (!this.auditMode) this.initializeDiscovery();
    const pendingCareer = wx.getStorageSync("anime-master-v063-market-career");
    if (!careerTabs.some((item) => item.name === pendingCareer)) return;
    wx.removeStorageSync("anime-master-v063-market-career");
    const state = this.discovery[pendingCareer];
    this.setData({
      career: pendingCareer,
      mode: "works",
      searchQuery: state.query,
      searchDraft: state.query,
      recent: state.recent.slice(),
      selectedFilters: state.filters.slice(),
      filterDraft: state.filters.slice(),
      searchOpen: false,
      filterOpen: false
    }, () => {
      this.refreshFilterGroups();
      this.refreshResults();
    });
  },

  completeFirstUse() { this.cloudCatalogLoaded=false; if(this.discoveryInitializing)this.firstUsePending=true; else this.initializeDiscovery(); },
  async initializeDiscovery() {
    if (this.discoveryInitializing || this.discoveryRegionSaving) return;
    const startupApp = typeof getApp === 'function' ? getApp() : null;
    const startupLocation = startupApp?.discoveryLocationReady;
    const age = Date.now() - this.catalogLoadedAt;
    if (!startupLocation && !startupApp?.globalData.pendingDiscoveryLocation && this.cloudCatalogLoaded && this.catalogCacheRevision === displayCache.revision() && age >= 0 && age < 5 * 60 * 1000) return;
    const requestId = this.discoveryInitializationId = (this.discoveryInitializationId || 0) + 1;
    this.discoveryInitializing = true;
    const cached = locationPreference(cloudAccount.peekDiscoveryPreference(), LOCATION_MAX_AGE_MS);
    const locating = Boolean(startupLocation || startupApp?.globalData.pendingDiscoveryLocation);
    this.setData({ catalogLoading: true, catalogError: "", locationState: cached ? "ready" : "pending", locationMessage: "" });
    if (cached && !locating) {
      this.setData({ city: cached.cityName, locationLabel: regionLabel(cached), cityCode: cached.cityCode,
        regionValue: [cached.provinceName || "", cached.cityName, cached.districtName || ""] });
      setDiscoveryContext({ city: cached.cityName, cityCode: cached.cityCode, date: this.data.date });
      this.loadCloudCatalog();
    }
    try {
      let [{ preference }] = await Promise.all([cloudAccount.getDiscoveryPreference(), startupLocation]);
      if (requestId !== this.discoveryInitializationId) return;
      const app=typeof getApp === "function" ? getApp() : null;
      const location=app && app.globalData.pendingDiscoveryLocation;
      if(location){
        delete app.globalData.pendingDiscoveryLocation;
        ({preference}=await cloudAccount.resolveDiscoveryLocation(preference ? preference.version : 0,location.latitude,location.longitude));
        if(requestId !== this.discoveryInitializationId)return;
      }
      this.discoveryPreferenceVersion = preference ? preference.version : 0;
      const usable = locationPreference(preference, LOCATION_MAX_AGE_MS);
      if (usable) {
        if (locating || !cached || usable.cityCode !== cached.cityCode || regionLabel(usable) !== regionLabel(cached)) await this.applyDiscoveryRegion(usable, false);
      } else {
        this.catalogRequestId = (this.catalogRequestId || 0) + 1;
        this.cloudCatalogLoaded = false;
        this.setData({ city: "", locationLabel: "", cityCode: "", regionValue: [], visibleWorks: [], visibleProviders: [], catalogLoading: false, locationState: "manual", locationMessage: "选择服务城市后，为你展示当地可合作的人与作品" });
      }
    } catch (_) {
      if (requestId !== this.discoveryInitializationId) return;
      if (cached && locating) await this.applyDiscoveryRegion(cached, false);
      if (!cached) this.setData({ catalogLoading: false, locationState: "manual", locationMessage: "选择服务城市后，为你展示当地可合作的人与作品" });
    } finally {
      if (requestId === this.discoveryInitializationId) {
        this.discoveryInitializing = false;
        if(this.firstUsePending){this.firstUsePending=false;this.initializeDiscovery();}
      }
    }
  },

  applyDiscoveryRegion(region, persistManual) {
    if (persistManual && typeof getApp === 'function') require('../../services/startup-location').cancel(getApp());
    const requestId = this.regionRequestId = (this.regionRequestId || 0) + 1;
    this.discoveryRegionSaving = Boolean(persistManual);
    this.catalogRequestId = (this.catalogRequestId || 0) + 1;
    this.discoveryInitializationId = (this.discoveryInitializationId || 0) + 1;
    this.discoveryInitializing = false;
    if (this.auditMode && localPreview.isLocal()) {
      wx.setStorageSync(PREVIEW_REGION_KEY, { provinceName: region.provinceName || "", cityName: region.cityName, districtName: region.districtName || "", cityCode: region.cityCode, source: "MANUAL" });
    }
    const value = [region.provinceName || "", region.cityName || "", region.districtName || ""];
    this.setData({ city: region.cityName, locationLabel: regionLabel(region), cityCode: region.cityCode, regionValue: value, locationState: "ready", locationMessage: "" });
    setDiscoveryContext({ city: region.cityName, cityCode: region.cityCode, date: this.data.date });
    if (!this.auditMode) this.setData({ catalogLoading: true, catalogError: "" });
    let save = Promise.resolve();
    if (persistManual) {
      save = (this.discoverySavePending || Promise.resolve()).catch(() => {}).then(async () => {
        if (requestId !== this.regionRequestId) return;
        if (this.discoveryPreferenceVersion === undefined) {
          const { preference } = await cloudAccount.getDiscoveryPreference();
          if (requestId !== this.regionRequestId) return;
          this.discoveryPreferenceVersion = preference ? preference.version : 0;
        }
        try {
          const { preference } = await cloudAccount.saveDiscoveryPreference(this.discoveryPreferenceVersion, region, "MANUAL");
          this.discoveryPreferenceVersion = preference.version;
        } catch (error) {
          this.discoveryPreferenceVersion = undefined;
          throw error;
        }
      });
      this.discoverySavePending = save;
    }
    return save.then(() => {
      if (requestId !== this.regionRequestId) return;
      return this.auditMode ? this.refreshResults() : this.loadCloudCatalog();
    }).catch(error => {
      if (requestId === this.regionRequestId) throw error;
    }).finally(() => {
      if (requestId === this.regionRequestId) this.discoveryRegionSaving = false;
    });
  },

  loadCloudCatalog() {
    if (!this.data.cityCode) {
      this.catalogRequestId = (this.catalogRequestId || 0) + 1;
      return Promise.resolve();
    }
    return loadDiscoveryPage(this).then(() => {
      if (!this.unloaded && !this.auditMode && !this.data.catalogError && !this.data.catalogLoading) require('../../services/background-reads').schedule('buyer');
    });
  },

  loadMoreCatalog() {
    if (this.auditMode || this.data.role === "provider") return Promise.resolve();
    return loadDiscoveryPage(this, true);
  },

  onReachBottom() {
    return this.loadMoreCatalog();
  },

  onHide() {
    this.sessionShowId = (this.sessionShowId || 0) + 1;
    this.discoveryInitializationId = (this.discoveryInitializationId || 0) + 1;
    this.discoveryInitializing = false;
    this.catalogRequestId = (this.catalogRequestId || 0) + 1;
  },

  onUnload() {
    this.unloaded = true;
    this.sessionShowId = (this.sessionShowId || 0) + 1;
    this.regionRequestId = (this.regionRequestId || 0) + 1;
    this.discoveryRegionSaving = false;
    this.discoveryInitializationId = (this.discoveryInitializationId || 0) + 1;
    this.discoveryInitializing = false;
    this.catalogRequestId = (this.catalogRequestId || 0) + 1;
    this.dashboardRequestId = (this.dashboardRequestId || 0) + 1;
  },

  syncNativeTabBar(role) {
    if (!wx.setTabBarItem) return;
    const homeIcon = role === "provider" ? "/assets/nav/workbench-line.png" : "/assets/nav/market-line.png";
    const thirdIcon = role === "provider" ? "/assets/nav/calendar-line.png" : "/assets/nav/project-line.png";
    wx.setTabBarItem({ index: 0, text: role === "provider" ? "工作台" : "找高手", iconPath: homeIcon, selectedIconPath: homeIcon.replace(".png", "-active.png") });
    wx.setTabBarItem({ index: 2, text: role === "provider" ? "档期" : "项目", iconPath: thirdIcon, selectedIconPath: thirdIcon.replace(".png", "-active.png") });
  },

  retryDashboard() {
    if (this.unloaded || this.data.role !== 'provider' || this.data.dashboardLoading) return;
    return this.loadProviderDashboard();
  },

  async loadProviderDashboard() {
    if (this.unloaded) return;
    const requestId = this.dashboardRequestId = (this.dashboardRequestId || 0) + 1;
    this.dashboardCloudMode = !this.auditMode;
    if (this.dashboardCloudMode) {
      const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : undefined;
      if (this.dashboardOwner !== owner) {
        this.providerOrders = [];
        this.setData({ profile: null, profileInitial: '', providerCareer: '', storefrontPublished: null, metrics: [], priorityOrders: [], priorityTotal: 0, remainingPriority: 0, overview: [] });
      }
      this.dashboardOwner = owner;
      this.setData({ dashboardCached: false });
      const current = () => !this.unloaded && requestId === this.dashboardRequestId
        && owner === (typeof getApp === 'function' ? getApp().globalData.account?.id : undefined);
      this.setData({ dashboardLoading: true, dashboardError: "", providerVisibilityText: "" });
      const firstContent = screenPerformance.begin("provider-home");
      const cacheRevision = displayCache.revision();
      const snapshot = displayCache.read("workbench");
      if (snapshot) { this.providerOrders = snapshot.priorityOrders; this.setData({ ...snapshot, dashboardCached: true }, () => { if (current()) firstContent("cache"); }); }
      const cached = cloudAccount.peekMine();
      if (cached && !snapshot) this.setData({ profile: { nickname: cached.nickname, avatar: cached.avatarUrl || "" }, profileInitial: (cached.nickname || "我").slice(0, 1) });
      try {
        const accountReady = cloudAccount.getMine().then(account => {
          if (current()) this.setData({ profile: { nickname: account.nickname, avatar: account.avatarUrl || "" }, profileInitial: account.nickname.slice(0, 1) });
          return account;
        });
        const catalogReady = cached ? cloudCatalog.getProvider(cached.id, { images: false }) : accountReady.then(account => current() ? cloudCatalog.getProvider(account.id, { images: false }) : null);
        const ordersReady = cached ? cloudOrders.listOrders() : accountReady.then(() => current() ? cloudOrders.listOrders() : []);
        const [account, orders, catalog] = await Promise.all([accountReady, ordersReady, catalogReady]);
        if (!current()) return;
        const providerOrders = orders.filter((order) => order.providerId === account.id);
        const provider = catalog.provider;
        const allPriority = providerOrders.filter((order) => PRIORITY_STAGES.includes(order.stage));
        this.providerOrders = providerOrders;
        this.setData({
          profile: { nickname: account.nickname, avatar: account.avatarUrl || "" }, profileInitial: account.nickname.slice(0, 1),
          providerCareer: provider && provider.career || "资料待发布",
          providerVisibilityText: provider ? "主页公开展示中" : "主页尚未公开", storefrontPublished: Boolean(provider),
          metrics: [
            { flow: "booking", count: countFlow(providerOrders, "booking"), label: "预约沟通" },
            { flow: "production", count: countFlow(providerOrders, "production"), label: "项目执行" },
            { flow: "acceptance", count: countFlow(providerOrders, "acceptance"), label: "验收结算" }
          ],
          priorityOrders: allPriority.slice(0, PRIORITY_PREVIEW_LIMIT).map((order) => ({ ...order, statusLabel: stageLabels[order.stage] })),
          priorityTotal: allPriority.length, remainingPriority: Math.max(0, allPriority.length - PRIORITY_PREVIEW_LIMIT),
          overview: [],
          dashboardLoading: false, dashboardCached: false
        }, () => { if (current()) { firstContent("network"); require("../../services/background-reads").schedule("provider"); } });
        const { profile, profileInitial, providerCareer, providerVisibilityText, storefrontPublished, metrics, priorityOrders, priorityTotal, remainingPriority, overview } = this.data;
        displayCache.write("workbench", { profile, profileInitial, providerCareer, providerVisibilityText, storefrontPublished, metrics, priorityOrders, priorityTotal, remainingPriority, overview }, owner, cacheRevision);
      } catch (error) {
        if (!current()) return;
        if (snapshot) { this.setData({ dashboardLoading: false, dashboardError: "刷新失败，请重试" }); return; }
        this.providerOrders = [];
        this.setData({ providerVisibilityText: "主页状态暂不可用", storefrontPublished: null, dashboardLoading: false, dashboardError: "工作台暂不可用，请稍后重试。",
          metrics: [], priorityOrders: [], priorityTotal: 0, remainingPriority: 0, overview: [] });
      }
      return;
    }
    const orders = store.getOrders().filter((order) => order.providerId === store.CURRENT_PROVIDER_ID);
    const profile = store.getProfile();
    const provider = serviceProviders.find((item) => item.id === store.CURRENT_PROVIDER_ID) || serviceProviders[0];
    const allPriority = orders.filter((order) => PRIORITY_STAGES.includes(order.stage));
    const reviewCount = orders.filter((order) => order.rating > 0).length;
    this.setData({
      profile,
      profileInitial: profile.nickname.slice(0, 1),
      providerCareer: provider.career,
      providerVisibilityText: "界面预览",
      metrics: [
        { flow: "booking", count: countFlow(orders, "booking"), label: "预约沟通" },
        { flow: "production", count: countFlow(orders, "production"), label: "项目执行" },
        { flow: "acceptance", count: countFlow(orders, "acceptance"), label: "验收结算" }
      ],
      priorityOrders: allPriority.slice(0, PRIORITY_PREVIEW_LIMIT).map((order) => Object.assign({}, order, { statusLabel: stageLabels[order.stage] })),
      priorityTotal: allPriority.length,
      remainingPriority: Math.max(0, allPriority.length - PRIORITY_PREVIEW_LIMIT),
      overview: [
        { label: "作品", value: `${store.getWorks().length} 件公开作品` },
        { label: "服务", value: `${store.getServices().length} 个可预约项目` },
        { label: "档期", value: `${store.getAvailableDays().length} 个公开可约日` },
        { label: "评价", value: `${reviewCount} 条完成订单评价` }
      ]
    });
  },

  refreshResults(onRendered) {
    const { career, city, searchQuery, selectedFilters } = this.data;
    const keyword = searchQuery.trim().toLowerCase();
    const visibleProviders = this.marketProviders.filter((provider) => {
      if (!this.auditMode) return true;
      if (provider.career !== career || provider.city.replace(/市$/, "") !== city.replace(/市$/, "")) return false;
      const searchable = [provider.name, provider.handle, ...provider.tags].join(" ").toLowerCase();
      const matchesKeyword = !keyword || searchable.includes(keyword) || provider.works.some((work) => [work.title, work.subtitle, work.description, ...work.tags].join(" ").toLowerCase().includes(keyword));
      const minimumPrice = Math.min(...provider.services.map((service) => service.price));
      return matchesKeyword && matchesFilters(career, selectedFilters, provider.tags, minimumPrice);
    }).map((provider) => {
      const result = buildProvider(provider);
      if (!this.auditMode) result.availabilityDays = buildCloudAvailability(this.data.date, provider.discovery && provider.discovery.availabilityState);
      return result;
    });
    const providerIds = visibleProviders.map((provider) => provider.id);
    const visibleWorks = this.marketWorks
      .filter((work) => providerIds.includes(work.provider.id))
      .filter((work) => !this.auditMode || !keyword || [work.title, work.subtitle, work.description, work.provider.name, ...work.tags].join(" ").toLowerCase().includes(keyword))
      .filter((work) => !this.auditMode || matchesFilters(career, selectedFilters, work.provider.tags.concat(work.tags), work.price))
      .map(buildWork);
    this.setData({ visibleProviders, visibleWorks }, onRendered);
  },

  refreshFilterGroups() {
    const selected = this.data.filterDraft;
    const groups = discoveryControls.groupsForKind(filterOptions[this.data.career], this.data.filterKind).map((group) => ({
      group: group.group,
      values: group.values.map((value) => ({ value, selected: selected.includes(value) }))
    }));
    const selectedFilters = this.data.selectedFilters;
    const priceValues = discoveryControls.groupsForKind(filterOptions[this.data.career], "price").flatMap(group => group.values);
    this.setData({ availableFilterGroups: groups, priceActive: selectedFilters.some(value => priceValues.includes(value)), styleActive: selectedFilters.some(value => !priceValues.includes(value)) });
  },

  saveCurrentDiscovery() {
    this.discovery[this.data.career] = {
      query: this.data.searchQuery,
      filters: this.data.selectedFilters.slice(),
      recent: this.data.recent.slice()
    };
  },

  chooseCareer(event) {
    this.saveCurrentDiscovery();
    const career = event.currentTarget.dataset.career;
    const state = this.discovery[career];
    this.setData({
      career,
      searchQuery: state.query,
      searchDraft: state.query,
      selectedFilters: state.filters.slice(),
      filterDraft: state.filters.slice(),
      recent: state.recent.slice()
    }, () => {
      this.refreshFilterGroups();
      if (this.auditMode) this.refreshResults(); else this.loadCloudCatalog();
    });
  },

  updateCity(event) {
    const region = pickerRegion(event.detail);
    if (!region) return wx.showToast({ title: "未能识别所选城市，请重试", icon: "none" });
    this.cloudCatalogLoaded = false;
    const save = this.applyDiscoveryRegion(region, !this.auditMode);
    const requestId = this.regionRequestId;
    return save.catch(() => {
      if (requestId === this.regionRequestId) this.setData({ catalogLoading: false, catalogError: "城市保存失败，请重试" });
    });
  },

  updateDate(event) {
    this.dateManuallySelected = true;
    this.setData({ date: event.detail.value }, () => {
      setDiscoveryContext({ city: this.data.city, cityCode: this.data.cityCode, date: this.data.date });
      this.auditMode ? this.refreshResults() : this.loadCloudCatalog();
    });
  },

  chooseMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!['works', 'people'].includes(mode) || mode === this.data.mode) return;
    this.setData({ mode }, () => this.auditMode ? this.refreshResults() : this.loadCloudCatalog());
  },

  openSearch() {
    this.setData({ searchOpen: true, searchDraft: this.data.searchQuery });
  },

  closeSearch() {
    this.setData({ searchOpen: false, searchDraft: this.data.searchQuery });
  },

  updateSearchDraft(event) {
    this.setData({ searchDraft: event.detail.value });
  },

  submitSearch(event) {
    const supplied = event && event.currentTarget && event.currentTarget.dataset.value;
    const query = String(supplied || this.data.searchDraft).trim();
    const recent = query ? [query, ...this.data.recent.filter((item) => item !== query)].slice(0, 5) : this.data.recent;
    this.setData({ searchOpen: false, searchQuery: query, searchDraft: query, recent }, () => {
      this.saveCurrentDiscovery();
      wx.navigateTo({ url: `/pages/search-results/index?career=${encodeURIComponent(this.data.career)}&city=${encodeURIComponent(this.data.city)}&cityCode=${encodeURIComponent(this.data.cityCode)}&date=${encodeURIComponent(this.data.date)}&q=${encodeURIComponent(query)}&filters=${encodeURIComponent(this.data.selectedFilters.join("|"))}` });
    });
  },

  clearRecent() {
    this.setData({ recent: [] }, () => this.saveCurrentDiscovery());
  },

  removeRecent(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({ recent: this.data.recent.filter((item) => item !== value) }, () => this.saveCurrentDiscovery());
  },

  openFilters(event) {
    const filterKind = event && event.currentTarget && event.currentTarget.dataset.kind === "price" ? "price" : "style";
    this.setData({ filterKind, filterOpen: true, filterDraft: this.data.selectedFilters.slice() }, () => this.refreshFilterGroups());
  },

  closeFilters() {
    this.setData({ filterOpen: false, filterDraft: this.data.selectedFilters.slice() }, () => this.refreshFilterGroups());
  },

  clearSearchFilters() {
    this.cloudCatalogLoaded = false;
    this.setData({ selectedFilters: [], filterDraft: [], filterOpen: false }, () => {
      this.saveCurrentDiscovery();
      this.refreshFilterGroups();
    });
  },

  resetFilters() {
    this.setData({ filterDraft: discoveryControls.resetKind(this.data.filterDraft, filterOptions[this.data.career], this.data.filterKind) }, () => this.refreshFilterGroups());
  },

  toggleFilter(event) {
    const value = event.currentTarget.dataset.value;
    const filterDraft = this.data.filterDraft.includes(value)
      ? this.data.filterDraft.filter((item) => item !== value)
      : [...this.data.filterDraft, value];
    this.setData({ filterDraft }, () => this.refreshFilterGroups());
  },

  applyFilters() {
    const selectedFilters = this.data.filterDraft.slice();
    this.setData({ filterOpen: false, selectedFilters }, () => {
      this.saveCurrentDiscovery();
      wx.navigateTo({ url: `/pages/search-results/index?career=${encodeURIComponent(this.data.career)}&city=${encodeURIComponent(this.data.city)}&cityCode=${encodeURIComponent(this.data.cityCode)}&date=${encodeURIComponent(this.data.date)}&q=${encodeURIComponent(this.data.searchQuery)}&filters=${encodeURIComponent(selectedFilters.join("|"))}` });
    });
  },

  showProvider(event) {
    wx.navigateTo({ url: `/pages/provider-detail/index?id=${event.currentTarget.dataset.id}&source=B01` });
  },

  openFlow(event) {
    wx.setStorageSync("anime-master-root-order-group", event.currentTarget.dataset.flow);
    wx.switchTab({ url: "/pages/orders/index" });
  },

  openPriority(event) {
    if (this.unloaded || this.dashboardCloudMode && this.dashboardOwner !== (typeof getApp === 'function' ? getApp().globalData.account?.id : undefined)) return;
    const order = this.dashboardCloudMode ? (this.providerOrders || []).find((item) => item.id === event.currentTarget.dataset.id) : store.findOrder(event.currentTarget.dataset.id);
    if (!order) return;
    const page = order.stage === "NDA_PROVIDER_PENDING" ? "provider-task" : "provider-request";
    wx.navigateTo({ url: `/pages/${page}/index?id=${order.id}` });
  },

  openProviderWork() { wx.navigateTo({ url: `/pages/provider-profile/index?edit=1&section=works${this.auditMode ? "&audit=1" : ""}` }); },
  openProviderProfile() {
    this.storefrontReturn = { owner: displayCache.owner(), revision: displayCache.revision(), at: Date.now() };
    wx.navigateTo({ url: "/pages/provider-profile/index?from=workbench", fail: () => { this.storefrontReturn = null; } });
  },
  openProviderCalendar() { wx.switchTab({ url: "/pages/projects/index" }); },
  openProviderOrders() { wx.switchTab({ url: "/pages/orders/index" }); },
  openProviderReviews() { wx.navigateTo({ url: "/pages/provider-reviews/index" }); },

  noop() {}
});
