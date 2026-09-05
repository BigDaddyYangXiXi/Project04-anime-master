const { providers, filterOptions, allWorks } = require("../../data/catalog");
const store = require("../../data/v063-store");
const { providers: serviceProviders, stageLabels, stageFlows, matchesFilters, availability } = require("../../data/v063");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudOrders = require("../../services/cloud-orders");
const cloudAvailability = require("../../services/cloud-availability");
const cloudAccount = require("../../services/cloud-account");
const calendarModel = require("../../data/calendar-model");
const { mapCloudCatalog } = require("../../data/cloud-public-catalog");
const { fuzzyLocation, locationPreference, pickerRegion } = require("../../utils/discovery-region");
const { serverFilters } = require("../../utils/discovery-query");
const { setDiscoveryContext } = require("../../data/discovery-context");

const PRIORITY_STAGES = ["REQUESTED", "SUPPLEMENTED", "CONTACTING", "NDA_PROVIDER_PENDING", "REVISION_REQUESTED"];
const PRIORITY_PREVIEW_LIMIT = 5;
const LOCATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function countFlow(orders, flow) {
  return orders.filter((order) => stageFlows[flow].includes(order.stage)).length;
}

const careerTabs = [
  { name: "妆娘", letters: ["妆", "娘"], asset: "/assets/careers/zhuangniang.png" },
  { name: "毛娘", letters: ["毛", "娘"], asset: "/assets/careers/maoniang.png" },
  { name: "摄影", letters: ["摄", "影"], asset: "/assets/careers/sheying.png" },
  { name: "后期", letters: ["后", "期"], asset: "/assets/careers/houqi.png" }
];

const initialDiscovery = {
  妆娘: { query: "", filters: [], recent: ["男角", "伤效妆", "古风"] },
  毛娘: { query: "", filters: [], recent: ["复杂造型", "长发", "古风"] },
  摄影: { query: "", filters: [], recent: ["夜景", "剧情感", "棚拍"] },
  后期: { query: "", filters: [], recent: ["短视频", "氛围调色", "赛博特效"] }
};

const weekdayLabels = ["今天", "周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const calendarWeekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function tomorrowKey(now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return calendarModel.todayKey(tomorrow);
}

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
    miniWorks: provider.works.slice(0, 3),
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
    priceText: `￥${entry.price}`,
    provider: Object.assign({}, entry.provider, { initial: entry.provider.name.slice(0, 1) })
  });
}

Page({
  discovery: JSON.parse(JSON.stringify(initialDiscovery)),

  data: {
    role: "buyer",
    careerTabs,
    career: "妆娘",
    city: "",
    cityCode: "",
    regionValue: [],
    locationState: "pending",
    locationMessage: "正在确定你所在的城市",
    date: "",
    mode: "works",
    searchOpen: false,
    searchDraft: "",
    searchQuery: "",
    recent: initialDiscovery.妆娘.recent,
    filterOpen: false,
    selectedFilters: [],
    filterDraft: [],
    availableFilterGroups: [],
    visibleWorks: [],
    visibleProviders: [],
    profile: null,
    profileInitial: "",
    providerCareer: "",
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

  onLoad(options) {
    this.auditMode = options.audit === "1";
    this.marketProviders = this.auditMode ? providers : [];
    this.marketWorks = this.auditMode ? allWorks() : [];
    const requestedCareer = options.career ? decodeURIComponent(options.career) : "";
    const career = careerTabs.some((item) => item.name === requestedCareer) ? requestedCareer : "妆娘";
    const mode = options.mode === "people" ? "people" : "works";
    const selectedFilters = options.filters ? decodeURIComponent(options.filters).split("|").filter(Boolean) : [];
    const filterDraft = options.filterDraft ? decodeURIComponent(options.filterDraft).split("|").filter(Boolean) : selectedFilters.slice();
    const searchQuery = options.q ? decodeURIComponent(options.q) : "";
    this.discovery[career] = Object.assign({}, this.discovery[career], { query: searchQuery, filters: selectedFilters });
    this.setData({
      career,
      city: this.auditMode ? "杭州" : "",
      cityCode: this.auditMode ? "330100" : "",
      regionValue: this.auditMode ? ["浙江省", "杭州市", ""] : [],
      locationState: this.auditMode ? "ready" : "pending",
      locationMessage: this.auditMode ? "" : "正在确定你所在的城市",
      date: this.auditMode ? "2026-08-16" : tomorrowKey(),
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
    const role = wx.getStorageSync("animeMasterRole") === "provider" ? "provider" : "buyer";
    this.setData({ role });
    this.syncNativeTabBar(role);
    if (role === "provider") {
      this.loadProviderDashboard();
      return;
    }
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

  async initializeDiscovery() {
    if (this.discoveryInitializing || this.cloudCatalogLoaded) return;
    this.discoveryInitializing = true;
    this.setData({ catalogLoading: true, catalogError: "", locationState: "pending", locationMessage: "正在确定你所在的城市" });
    try {
      const { preference } = await cloudAccount.getDiscoveryPreference();
      this.discoveryPreferenceVersion = preference ? preference.version : 0;
      const usable = locationPreference(preference, LOCATION_MAX_AGE_MS);
      if (usable) {
        await this.applyDiscoveryRegion(usable, false);
      } else {
        const location = await fuzzyLocation();
        const resolved = await cloudAccount.resolveDiscoveryLocation(this.discoveryPreferenceVersion, location.latitude, location.longitude);
        this.discoveryPreferenceVersion = resolved.preference.version;
        await this.applyDiscoveryRegion(resolved.preference, false);
      }
    } catch (error) {
      const notConfigured = error && error.code === "LOCATION_SERVICE_NOT_CONFIGURED";
      this.setData({ catalogLoading: false, locationState: "manual", locationMessage: notConfigured ? "城市解析服务尚未配置，请手动选择服务城市" : "未能读取城市，请手动选择服务城市" });
    } finally {
      this.discoveryInitializing = false;
    }
  },

  applyDiscoveryRegion(region, persistManual) {
    const value = [region.provinceName || "", region.cityName || "", region.districtName || ""];
    this.setData({ city: region.cityName, cityCode: region.cityCode, regionValue: value, locationState: "ready", locationMessage: "" });
    setDiscoveryContext({ city: region.cityName, cityCode: region.cityCode, date: this.data.date });
    const save = persistManual
      ? cloudAccount.saveDiscoveryPreference(this.discoveryPreferenceVersion || 0, region, "MANUAL").then(({ preference }) => { this.discoveryPreferenceVersion = preference.version; })
      : Promise.resolve();
    return save.then(() => this.loadCloudCatalog());
  },

  loadCloudCatalog() {
    if (!this.data.cityCode) return Promise.resolve();
    this.setData({ catalogLoading: true, catalogError: "" });
    return cloudCatalog.listDiscovery(serverFilters(this.data.cityCode, this.data.career, this.data.date, this.data.searchQuery, this.data.selectedFilters)).then(({ providers: cloudProviders }) => {
      const mapped = mapCloudCatalog(cloudProviders);
      this.marketProviders = mapped.providers;
      this.marketWorks = mapped.works;
      this.cloudCatalogLoaded = true;
      this.setData({ catalogLoading: false, catalogError: "" }, () => this.refreshResults());
    }).catch(() => {
      this.marketProviders = [];
      this.marketWorks = [];
      this.setData({ catalogLoading: false, catalogError: "公开目录加载失败，请稍后重试" }, () => this.refreshResults());
    });
  },

  syncNativeTabBar(role) {
    if (!wx.setTabBarItem) return;
    const homeIcon = role === "provider" ? "/assets/nav/workbench-tab.png" : "/assets/nav/market-tab.png";
    const thirdIcon = role === "provider" ? "/assets/nav/calendar-tab.png" : "/assets/nav/project-tab.png";
    wx.setTabBarItem({ index: 0, text: role === "provider" ? "工作台" : "找高手", iconPath: homeIcon, selectedIconPath: homeIcon });
    wx.setTabBarItem({ index: 2, text: role === "provider" ? "档期" : "项目", iconPath: thirdIcon, selectedIconPath: thirdIcon });
  },

  async loadProviderDashboard() {
    this.dashboardCloudMode = !this.auditMode;
    if (this.dashboardCloudMode) {
      this.setData({ dashboardLoading: true, dashboardError: "" });
      try {
        const account = await cloudAccount.getMine();
        const [orders, availabilityValue, catalog] = await Promise.all([cloudOrders.listOrders(), cloudAvailability.getMine(), cloudCatalog.getProvider(account.id)]);
        const providerOrders = orders.filter((order) => order.providerId === account.id);
        const provider = catalog.provider;
        const allPriority = providerOrders.filter((order) => PRIORITY_STAGES.includes(order.stage));
        const reviewCount = providerOrders.filter((order) => order.rating > 0).length;
        this.providerOrders = providerOrders;
        this.setData({
          profile: { nickname: account.nickname, avatar: account.avatarUrl || "" }, profileInitial: account.nickname.slice(0, 1),
          providerCareer: provider && provider.career || "资料待发布",
          metrics: [
            { flow: "booking", count: countFlow(providerOrders, "booking"), label: "预约沟通" },
            { flow: "production", count: countFlow(providerOrders, "production"), label: "项目执行" },
            { flow: "acceptance", count: countFlow(providerOrders, "acceptance"), label: "验收结算" }
          ],
          priorityOrders: allPriority.slice(0, PRIORITY_PREVIEW_LIMIT).map((order) => ({ ...order, statusLabel: stageLabels[order.stage] })),
          priorityTotal: allPriority.length, remainingPriority: Math.max(0, allPriority.length - PRIORITY_PREVIEW_LIMIT),
          overview: [
            { label: "作品", value: `${provider ? provider.works.length : 0} 件公开作品` },
            { label: "服务", value: `${provider ? provider.services.length : 0} 个可预约项目` },
            { label: "档期", value: `${availabilityValue.openDates.filter((date) => date >= calendarModel.todayKey()).length} 个公开可约日` },
            { label: "评价", value: `${reviewCount} 条完成订单评价` }
          ],
          dashboardLoading: false
        });
      } catch (error) {
        this.providerOrders = [];
        this.setData({ profile: { nickname: "资料读取失败", avatar: "" }, profileInitial: "资", providerCareer: "暂不可用", metrics: [], priorityOrders: [], priorityTotal: 0, remainingPriority: 0, overview: [], dashboardLoading: false, dashboardError: "工作台数据读取失败，请稍后重试。" });
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

  refreshResults() {
    const { career, city, searchQuery, selectedFilters } = this.data;
    const keyword = searchQuery.trim().toLowerCase();
    const visibleProviders = this.marketProviders.filter((provider) => {
      if (!this.auditMode) return true;
      if (provider.career !== career || provider.city !== city) return false;
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
      .filter((work) => !keyword || [work.title, work.subtitle, work.description, work.provider.name, ...work.tags].join(" ").toLowerCase().includes(keyword))
      .filter((work) => matchesFilters(career, selectedFilters, work.provider.tags.concat(work.tags), work.price))
      .map(buildWork);
    this.setData({ visibleProviders, visibleWorks });
  },

  refreshFilterGroups() {
    const selected = this.data.filterDraft;
    const groups = filterOptions[this.data.career].map((group) => ({
      group: group.group,
      values: group.values.map((value) => ({ value, selected: selected.includes(value) }))
    }));
    this.setData({ availableFilterGroups: groups });
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
    this.applyDiscoveryRegion(region, !this.auditMode).catch(() => this.setData({ catalogLoading: false, catalogError: "城市保存失败，请重试" }));
  },

  updateDate(event) {
    this.setData({ date: event.detail.value }, () => {
      setDiscoveryContext({ city: this.data.city, cityCode: this.data.cityCode, date: this.data.date });
      this.auditMode ? this.refreshResults() : this.loadCloudCatalog();
    });
  },

  chooseMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
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

  openFilters() {
    this.setData({ filterOpen: true, filterDraft: this.data.selectedFilters.slice() }, () => this.refreshFilterGroups());
  },

  closeFilters() {
    this.setData({ filterOpen: false, filterDraft: this.data.selectedFilters.slice() }, () => this.refreshFilterGroups());
  },

  resetFilters() {
    this.setData({ filterDraft: [] }, () => this.refreshFilterGroups());
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
    const order = this.dashboardCloudMode ? (this.providerOrders || []).find((item) => item.id === event.currentTarget.dataset.id) : store.findOrder(event.currentTarget.dataset.id);
    if (!order) return;
    const page = order.stage === "NDA_PROVIDER_PENDING" ? "provider-task" : "provider-request";
    wx.navigateTo({ url: `/pages/${page}/index?id=${order.id}` });
  },

  openProviderProfile() { wx.navigateTo({ url: "/pages/provider-profile/index" }); },
  openProviderCalendar() { wx.switchTab({ url: "/pages/projects/index" }); },
  openProviderOrders() { wx.switchTab({ url: "/pages/orders/index" }); },
  openProviderReviews() { wx.navigateTo({ url: "/pages/provider-reviews/index" }); },

  noop() {}
});
