const localPreview = require("../../utils/local-preview");
const { providers, allWorks } = require("../../data/catalog");
const { matchesFilters } = require("../../data/v063");
const { loadDiscoveryPage } = require("../../utils/discovery-pagination");

const initialRecent = {
  妆娘: ["男角", "伤效妆", "古风"],
  毛娘: ["复杂造型", "长发", "古风"],
  摄影: ["夜景", "剧情感", "棚拍"],
  后期: ["短视频", "氛围调色", "赛博特效"]
};

function buildWork(entry) {
  return Object.assign({}, entry, {
    listKey: `${entry.provider.id}:${entry.id}`,
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

  onNavigationLayout(event) {
    this.setData({ navigationHeight: event.detail.totalHeight });
  },

  onLoad(options) {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const origin = pages.length > 1 ? pages[pages.length - 2] : null;
    this.discoveryOrigin = origin && origin.route === 'pages/discover/index' ? origin : null;
    this.auditMode = localPreview.isAudit(options);
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
    return loadDiscoveryPage(this);
  },

  loadMoreCatalog() {
    if (this.auditMode || this.data.role === "provider") return Promise.resolve();
    return loadDiscoveryPage(this, true);
  },

  onReachBottom() {
    return this.loadMoreCatalog();
  },

  onUnload() {
    this.catalogRequestId = (this.catalogRequestId || 0) + 1;
    if (this.discoveryOrigin && this.discoveryOrigin.data.role === 'buyer') this.discoveryOrigin.clearSearchFilters();
    this.discoveryOrigin = null;
  },

  refreshResults(onRendered) {
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
    this.setData({ results }, onRendered);
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
