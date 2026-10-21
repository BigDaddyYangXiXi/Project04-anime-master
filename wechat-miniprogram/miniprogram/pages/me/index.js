const screenPerformance = require("../../utils/screen-performance");
const displayCache = require("../../utils/display-cache");
const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const cloudAccount = require("../../services/cloud-account");
const cloudOrders = require("../../services/cloud-orders");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudSavedItems = require("../../services/cloud-saved-items");
const activity = require('../../data/me-activity');
const cloudProjects = require('../../services/cloud-projects');

function collectionEntries(values = {}) {
  return [
    { key: "followed", label: "我的关注", value: values.followed ?? "—" },
    { key: "liked", label: "我的喜欢", value: values.liked ?? "—" },
    { key: "referenced", label: "参考作品", value: values.referenced ?? "—" }
  ];
}

function buyerHighlights(started = "—", liked = "—", followed = "—") {
  return [{ key: "liked", label: "喜欢", value: liked }, { key: "followed", label: "关注", value: followed }, { key: "orders", label: "合作", value: started }];
}

Page({
  data: { role: "buyer", account: null, initial: "我", providerStats: [], buyerStats: [], buyerHighlights: buyerHighlights(), providerHighlights: [{key:'likes',label:'获赞',value:'—'},{key:'followers',label:'粉丝',value:'—'},{key:'coops',label:'合作',value:'—'}], assets: collectionEntries(), storefrontStatusText: "", previewMeta: "", dashboardLoading: false, dashboardError: "", todoText: '正在读取待办', projectText: '整理角色与合作需求', recentProject: null, projectReady: false },

  onLoad(options) {
    this.unloaded = false;
    this.setData({ previewOnly: localPreview.isLocal() });
    this.auditRole = localPreview.isAudit(options) && ["buyer", "provider"].includes(options.role) ? options.role : "";
    this.auditMode = localPreview.isAudit(options);
  },

  onShow() {
    const role = this.auditRole || wx.getStorageSync("animeMasterRole") || "buyer";
    wx.setStorageSync("animeMasterRole", role);
    this.syncNativeTabBar(role);
    if (!this.auditMode) { this.loadCloudDashboard(role); if (role === 'buyer') this.loadProjects(); return; }
    const dashboard = store.getMeDashboard(role);
    const account = localPreview.isLocal() ? store.getAccount(role) : dashboard.account || { nickname: "未设置昵称", avatar: "" };
    this.setData({
      role, account, initial: (account.nickname || "我").slice(0, 1),
      assets: dashboard.assets, buyerHighlights: buyerHighlights("—", dashboard.assets.find(item => item.key === "liked")?.value, dashboard.assets.find(item => item.key === "followed")?.value),
      providerStats: role === "provider" ? dashboard.stats : [],
      buyerStats: role === "buyer" ? dashboard.stats : [],
      storefrontStatusText: dashboard.storefrontStatusText || "",
      previewMeta: Number.isFinite(dashboard.publishedWorksCount) ? `${dashboard.publishedWorksCount} 件作品正在公开展示` : ""
    });
  },

  async loadCloudDashboard(role) {
    if (this.unloaded) return;
    const owner = getApp().globalData.account?.id;
    if (this.dashboardOwner !== owner || this.data.role !== role) {
      this.setData({ account: null, initial: "我", providerStats: [], buyerStats: [], buyerHighlights: buyerHighlights(), assets: collectionEntries(), storefrontStatusText: "", previewMeta: "", providerHighlights: this.data.providerHighlights.map(item => ({ ...item, value: "—" })), todoText: "正在读取待办" });
    }
    this.dashboardOwner = owner;
    this.setData({ dashboardCached: false });
    this.serverAccountId = null;
    const requestId = this.dashboardRequestId = (this.dashboardRequestId || 0) + 1;
    const current = () => !this.unloaded && requestId === this.dashboardRequestId && owner === getApp().globalData.account?.id;
    this.setData({ role, dashboardLoading: true, dashboardError: "" });
    const firstContent = screenPerformance.begin("personal-center");
    const cacheRevision = displayCache.revision();
    const snapshotKey = role === "buyer" ? "me:buyer:v4" : "me:provider:v2";
    const snapshot = displayCache.read(snapshotKey);
    if (snapshot) this.setData({ ...snapshot, dashboardCached: true }, () => { if (current()) firstContent("cache"); });
    const cached = cloudAccount.peekMine();
    if (cached && !snapshot) this.setData({ account: { nickname: cached.nickname, username: cached.username || "", avatar: cached.avatarUrl || "" }, initial: (cached.nickname || "我").slice(0, 1) });
    try {
      const accountReady = cloudAccount.getMine().then(account => {
        if (current()) {
          this.serverAccountId = account.id;
          this.setData({ account: { nickname: account.nickname, username: account.username || "", avatar: account.avatarUrl || "" }, initial: account.nickname.slice(0, 1) });
        }
        return account;
      });
      const catalogReady = role === "buyer" ? Promise.resolve({ provider: null })
        : cached ? cloudCatalog.getProvider(cached.id, { images: false }) : accountReady.then(account => current() ? cloudCatalog.getProvider(account.id, { images: false }) : null);
      const [account, orders, catalog, saved] = await Promise.all([accountReady, cloudOrders.listOrders(), catalogReady, cloudSavedItems.listMine()]);
      if (!current()) return;
      const mine = orders.filter((order) => order.viewerRole === (role === "provider" ? "PROVIDER" : "BUYER"));
      const completedOrders = mine.filter((order) => order.stage === "COMPLETED").length;
      const referencedWorks = new Set(mine.map((order) => order.referenceWorkId).filter(Boolean)).size;
      const provider = catalog.provider;
      const assets = collectionEntries({ followed: saved.providerIds.length, liked: saved.workIds.length, referenced: role === "buyer" ? referencedWorks : "—" });
      this.serverAccountId = account.id;
      this.setData({
        account: { nickname: account.nickname, username: account.username || "", avatar: account.avatarUrl || "" }, initial: account.nickname.slice(0, 1), assets,
        buyerHighlights: role === "buyer" ? buyerHighlights(mine.length, saved.workIds.length, saved.providerIds.length) : buyerHighlights(),
        providerHighlights: [{ key: 'likes', label: '获赞', value: Number(saved.receivedWorkLikes || 0) }, { key: 'followers', label: '粉丝', value: Number(saved.receivedProviderFollows || 0) }, { key: 'coops', label: '合作', value: activity.select(mine, 'provider', 'coops').length }],
        todoText: activity.select(mine, role, 'todo').length ? `${activity.select(mine, role, 'todo').length} 笔订单需要处理` : '暂无需要处理的订单',
        providerStats: role === "provider" ? [
          { label: "历史合作", value: completedOrders },
          { label: "作品创作", value: provider ? provider.works.length : 0 },
          { label: "作品被参考", value: provider ? provider.works.reduce((sum, work) => sum + Number(work.referenceCount || 0), 0) : 0 },
          { label: "作品被收藏", value: Number(saved.receivedWorkLikes || 0) },
          { label: "账号获关注", value: Number(saved.receivedProviderFollows || 0) }
        ] : [],
        buyerStats: role === "buyer" ? [
          { label: "历史合作", value: completedOrders },
          { label: "进行中订单", value: mine.filter((order) => !["COMPLETED", "DECLINED"].includes(order.stage)).length },
          { label: "参考作品", value: referencedWorks }
        ] : [],
        storefrontStatusText: role === "provider" ? provider ? "橱窗已公开" : "橱窗未发布" : "",
        previewMeta: provider ? `${provider.works.length} 件作品正在公开展示` : "橱窗尚未发布",
        dashboardLoading: false, dashboardCached: false
      }, () => { if (current()) { firstContent("network"); require("../../services/background-reads").schedule(role); } });
      const { account: identity, initial, assets: cachedAssets, providerStats, buyerStats, buyerHighlights: highlights, providerHighlights, todoText, storefrontStatusText, previewMeta } = this.data;
      displayCache.write(snapshotKey, { account: identity, initial, assets: cachedAssets, providerStats, buyerStats, buyerHighlights: highlights, providerHighlights, todoText, storefrontStatusText, previewMeta }, owner, cacheRevision);
    } catch (error) {
      if (!current()) return;
      this.setData({ dashboardLoading: false, todoText: '订单读取失败，请重试', dashboardError: this.data.dashboardCached ? "刷新失败，请重试。" : "个人中心暂不可用，请稍后重试。" });
    }
  },

  retryDashboard() {
    if (this.unloaded || this.data.dashboardLoading) return;
    return this.loadCloudDashboard(this.data.role);
  },

  onHide() { this.dashboardRequestId = (this.dashboardRequestId || 0) + 1; this.projectRequest = (this.projectRequest || 0) + 1; },
  onUnload() { this.unloaded = true; this.onHide(); },

  async loadProjects() {
    const owner = getApp().globalData.account?.id, request = this.projectRequest = (this.projectRequest || 0) + 1;
    const keepProject = this.projectOwner === owner && this.data.projectReady;
    this.projectOwner = owner;
    if (!keepProject) this.setData({ recentProject: null, projectText: '正在读取项目', projectReady: false });
    try {
      const projects = await cloudProjects.listProjects();
      if (this.unloaded || request !== this.projectRequest || owner !== getApp().globalData.account?.id || this.data.role !== 'buyer') return;
      const latest = projects.slice().sort((a,b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
      this.setData({ projectReady: true, projectText: projects.length ? `${projects.length} 个项目` : '整理角色与合作需求', recentProject: latest ? { id: latest.id, title: latest.title || '未命名项目' } : null });
    } catch (_) { if (!this.unloaded && request === this.projectRequest && owner === getApp().globalData.account?.id) this.setData({ projectText: '项目读取失败，进入后重试', recentProject: null, projectReady: false }); }
  },
  openRecentProject() { if (this.data.recentProject && this.projectOwner === getApp().globalData.account?.id) wx.navigateTo({ url: '/pages/project-detail/index?id=' + encodeURIComponent(this.data.recentProject.id) }); else this.openBuyerProjects(); },
  openActivity(event) { wx.navigateTo({ url: '/pages/me-activity/index?mode=' + (event.currentTarget.dataset.mode || 'coops') }); },
  openProviderHighlight(event) { const key = event.currentTarget.dataset.type; wx.navigateTo({ url: key === 'coops' ? '/pages/me-activity/index?mode=coops' : '/pages/me-social/index?type=' + key }); },
  openReviews() { wx.navigateTo({ url: this.data.role === 'provider' ? '/pages/provider-reviews/index' : '/pages/me-activity/index?mode=reviews' }); },
  openHelp() { wx.navigateTo({ url: '/pages/help/index' }); },
  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },
  openCalendar() { wx.switchTab({ url: '/pages/projects/index' }); },
  openHighlight(event) { return this.data.role === 'buyer' ? this.openBuyerHighlight(event) : this.openProviderHighlight(event); },
  openBusiness() { return this.data.role === 'buyer' ? this.openBuyerProjects() : this.editStorefront(); },
  openTodo(event) { return this.data.dashboardError ? this.retryDashboard() : this.openActivity(event); },

  syncNativeTabBar(role) {
    if (!wx.setTabBarItem) return;
    const homeIcon = role === "provider" ? "/assets/nav/workbench-line.png" : "/assets/nav/market-line.png";
    const thirdIcon = role === "provider" ? "/assets/nav/calendar-line.png" : "/assets/nav/project-line.png";
    wx.setTabBarItem({ index: 0, text: role === "provider" ? "工作台" : "找高手", iconPath: homeIcon, selectedIconPath: homeIcon.replace(".png", "-active.png") });
    wx.setTabBarItem({ index: 2, text: role === "provider" ? "档期" : "项目", iconPath: thirdIcon, selectedIconPath: thirdIcon.replace(".png", "-active.png") });
  },

  switchIdentity() {
    const nextRole = this.data.role === "provider" ? "buyer" : "provider";
    wx.setStorageSync("animeMasterRole", nextRole);
    wx.switchTab({ url: "/pages/discover/index" });
  },

  openHomePreferences() { wx.navigateTo({url:"/pages/home-preferences/index"}); },
  editAccount() { wx.navigateTo({ url: `/pages/account-profile/index?role=${this.data.role}` }); },
  openAssets(event) { wx.navigateTo({ url: `/pages/me-assets/index?type=${event.currentTarget.dataset.type}` }); },
  editStorefront() {
    wx.setStorageSync("animeMasterRole", "provider");
    wx.navigateTo({ url: `/pages/provider-profile/index?edit=1&section=profile${this.auditMode ? "&audit=1" : ""}` });
  },
  openFunds() { wx.navigateTo({ url: "/pages/funds/index" }); },
  previewStorefront() {
    if (this.unloaded) return;
    if (!this.auditMode && (!this.serverAccountId || this.serverAccountId !== getApp().globalData.account?.id || this.data.dashboardLoading)) return wx.showToast({ title: "账号资料尚未读取完成，请稍后重试", icon: "none" });
    wx.navigateTo({ url: `/pages/provider-detail/index?id=${this.serverAccountId || store.CURRENT_PROVIDER_ID}&workspace=provider${this.auditMode ? "&audit=1" : ""}` }); },
  openBuyerHighlight(event) {
    const key = event.currentTarget.dataset.type;
    if (key === "orders") return wx.navigateTo({ url: '/pages/me-activity/index?mode=coops' });
    if (key === "liked" || key === "followed") this.openAssets(event);
  },
  openBuyerCooperations() { wx.setStorageSync("anime-master-root-order-group", "history"); wx.switchTab({ url: "/pages/orders/index" }); },
  openBuyerOrders() { wx.setStorageSync("anime-master-root-order-group", "booking"); wx.switchTab({ url: "/pages/orders/index" }); },
  openBuyerProjects() { wx.switchTab({ url: "/pages/projects/index" }); }
});
