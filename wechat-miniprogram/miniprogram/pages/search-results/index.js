const { providers, allWorks } = require("../../data/catalog");
const { matchesFilters } = require("../../data/v063");
const cloudCatalog = require("../../services/cloud-catalog");
const { mapCloudCatalog } = require("../../data/cloud-public-catalog");
const cloudAccount = require("../../services/cloud-account");
const { serverFilters } = require("../../utils/discovery-query");
const { setDiscoveryContext } = require("../../data/discovery-context");

const initialRecent = {
  妆娘: ["男角", "伤效妆", "古风"],
  毛娘: ["复杂造型", "长发", "古风"],
  摄影: ["夜景", "剧情感", "棚拍"],
  后期: ["短视频", "氛围调色", "赛博特效"]
};

function buildWork(entry) {
  return Object.assign({}, entry, {
    priceText: `￥${entry.price}`,
    provider: Object.assign({}, entry.provider, { initial: entry.provider.name.slice(0, 1) })
  });
}

Page({
  data: {
    career: "妆娘",
    city: "",
    cityCode: "",
    date: "",
    searchQuery: "",
    searchDraft: "",
    selectedFilters: [],
    recent: initialRecent.妆娘,
    results: [],
    searchOpen: false,
    catalogLoading: false,
    catalogError: ""
  },

  onLoad(options) {
    this.auditMode = options.audit === "1";
    this.marketProviders = this.auditMode ? providers : [];
    this.marketWorks = this.auditMode ? allWorks() : [];
    const career = options.career ? decodeURIComponent(options.career) : "妆娘";
    const city = options.city ? decodeURIComponent(options.city) : "";
    const cityCode = options.cityCode ? decodeURIComponent(options.cityCode) : "";
    const date = options.date ? decodeURIComponent(options.date) : "";
    const searchQuery = options.q ? decodeURIComponent(options.q) : "";
    const selectedFilters = options.filters ? decodeURIComponent(options.filters).split("|").filter(Boolean) : [];
    this.setData({
      career,
      city,
      cityCode,
      date,
      searchQuery,
      searchDraft: searchQuery,
      selectedFilters,
      recent: (initialRecent[career] || []).slice(),
      searchOpen: options.overlay === "search"
    }, () => {
      if (this.auditMode) this.refreshResults();
      else this.loadCloudCatalog();
    });
  },

  loadCloudCatalog() {
    this.setData({ catalogLoading: true, catalogError: "" });
    const cityReady = this.data.cityCode ? Promise.resolve({ cityCode: this.data.cityCode, cityName: this.data.city }) : cloudAccount.getDiscoveryPreference().then(({ preference }) => preference);
    cityReady.then((region) => {
      if (!region) { const error = new Error("city is required"); error.code = "CITY_REQUIRED"; throw error; }
      this.setData({ city: region.cityName, cityCode: region.cityCode });
      setDiscoveryContext({ city: region.cityName, cityCode: region.cityCode, date: this.data.date });
      return cloudCatalog.listDiscovery(serverFilters(region.cityCode, this.data.career, this.data.date, this.data.searchQuery, this.data.selectedFilters));
    }).then(({ providers: cloudProviders }) => {
      const mapped = mapCloudCatalog(cloudProviders);
      this.marketProviders = mapped.providers;
      this.marketWorks = mapped.works;
      this.setData({ catalogLoading: false, catalogError: "" }, () => this.refreshResults());
    }).catch(() => {
      this.marketProviders = [];
      this.marketWorks = [];
      this.setData({ catalogLoading: false, catalogError: "公开目录加载失败，请稍后重试" }, () => this.refreshResults());
    });
  },

  refreshResults() {
    const { career, city, searchQuery, selectedFilters } = this.data;
    const keyword = searchQuery.trim().toLowerCase();
    const providerIds = this.marketProviders
      .filter((provider) => !this.auditMode || provider.career === career && provider.city === city)
      .filter((provider) => {
        const minimumPrice = Math.min(...provider.services.map((service) => service.price));
        return !this.auditMode || matchesFilters(career, selectedFilters, provider.tags, minimumPrice);
      })
      .map((provider) => provider.id);
    const results = this.marketWorks
      .filter((work) => providerIds.includes(work.provider.id))
      .filter((work) => {
        const text = [work.title, work.subtitle, work.description, work.provider.name, ...work.tags].join(" ").toLowerCase();
        return !this.auditMode || (!keyword || text.includes(keyword)) && matchesFilters(career, selectedFilters, work.provider.tags.concat(work.tags), work.price);
      })
      .map(buildWork);
    this.setData({ results });
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
    const searchQuery = String(supplied || this.data.searchDraft).trim();
    const recent = searchQuery ? [searchQuery, ...this.data.recent.filter((item) => item !== searchQuery)].slice(0, 6) : this.data.recent;
    this.setData({ searchOpen: false, searchQuery, searchDraft: searchQuery, recent }, () => this.auditMode ? this.refreshResults() : this.loadCloudCatalog());
  },

  clearRecent() {
    this.setData({ recent: [] });
  },

  removeRecent(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({ recent: this.data.recent.filter((item) => item !== value) });
  },

  noop() {}
});
