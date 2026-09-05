const store = require("../../data/v063-store");
const pendingWorkUpload = require("../../data/pending-work-upload");
const { chooseWorkMedia } = require("../../utils/work-media-picker");
const cloudAccount = require("../../services/cloud-account");
const cloudOrders = require("../../services/cloud-orders");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudSavedItems = require("../../services/cloud-saved-items");

Page({
  data: { role: "buyer", account: null, initial: "我", providerStats: [], buyerStats: [], assets: [], storefrontStatusText: "数据待同步", previewMeta: "公开作品数量待同步", dashboardLoading: false, dashboardError: "" },

  onLoad(options) {
    this.auditRole = options.audit === "1" && ["buyer", "provider"].includes(options.role) ? options.role : "";
    this.auditMode = options.audit === "1";
  },

  onShow() {
    const role = this.auditRole || wx.getStorageSync("animeMasterRole") || "buyer";
    wx.setStorageSync("animeMasterRole", role);
    this.syncNativeTabBar(role);
    if (!this.auditMode) { this.loadCloudDashboard(role); return; }
    const dashboard = store.getMeDashboard(role);
    const account = dashboard.account || { nickname: "未设置昵称", avatar: "" };
    this.setData({
      role, account, initial: (account.nickname || "我").slice(0, 1),
      assets: dashboard.assets,
      providerStats: role === "provider" ? dashboard.stats : [],
      buyerStats: role === "buyer" ? dashboard.stats : [],
      storefrontStatusText: dashboard.storefrontStatusText || "数据待同步",
      previewMeta: Number.isFinite(dashboard.publishedWorksCount) ? `${dashboard.publishedWorksCount} 件作品正在公开展示` : "公开作品数量待同步"
    });
  },

  async loadCloudDashboard(role) {
    this.setData({ role, dashboardLoading: true, dashboardError: "" });
    try {
      const account = await cloudAccount.getMine();
      const [orders, catalog, saved] = await Promise.all([cloudOrders.listOrders(), cloudCatalog.getProvider(account.id), cloudSavedItems.listMine()]);
      const mine = orders.filter((order) => order.viewerRole === (role === "provider" ? "PROVIDER" : "BUYER"));
      const completedOrders = mine.filter((order) => order.stage === "COMPLETED").length;
      const referencedWorks = new Set(mine.map((order) => order.referenceWorkId).filter(Boolean)).size;
      const provider = catalog.provider;
      const assets = [
        { key: "followed", label: "我的关注", value: saved.providerIds.length },
        { key: "liked", label: "我的喜欢", value: saved.workIds.length },
        { key: "referenced", label: "引用作品", value: role === "buyer" ? referencedWorks : "—" }
      ];
      this.serverAccountId = account.id;
      this.setData({
        account: { nickname: account.nickname, avatar: account.avatarUrl || "" }, initial: account.nickname.slice(0, 1), assets,
        providerStats: role === "provider" ? [
          { label: "历史合作", value: completedOrders },
          { label: "作品创作", value: provider ? provider.works.length : 0 },
          { label: "作品被引用", value: provider ? provider.works.reduce((sum, work) => sum + Number(work.referenceCount || 0), 0) : 0 },
          { label: "作品被收藏", value: Number(saved.receivedWorkLikes || 0) },
          { label: "账号获关注", value: Number(saved.receivedProviderFollows || 0) }
        ] : [],
        buyerStats: role === "buyer" ? [
          { label: "历史合作", value: completedOrders },
          { label: "进行中订单", value: mine.filter((order) => !["COMPLETED", "DECLINED"].includes(order.stage)).length },
          { label: "引用作品", value: referencedWorks }
        ] : [],
        storefrontStatusText: role === "provider" ? provider ? "橱窗已公开" : "橱窗未发布" : "",
        previewMeta: provider ? `${provider.works.length} 件作品正在公开展示` : "橱窗尚未发布",
        dashboardLoading: false
      });
    } catch (error) {
      this.setData({ account: { nickname: "资料读取失败", avatar: "" }, initial: "资", assets: [], providerStats: [], buyerStats: [], dashboardLoading: false, dashboardError: "个人中心数据读取失败，请稍后重试。" });
    }
  },

  syncNativeTabBar(role) {
    if (!wx.setTabBarItem) return;
    const homeIcon = role === "provider" ? "/assets/nav/workbench-tab.png" : "/assets/nav/market-tab.png";
    const thirdIcon = role === "provider" ? "/assets/nav/calendar-tab.png" : "/assets/nav/project-tab.png";
    wx.setTabBarItem({ index: 0, text: role === "provider" ? "工作台" : "找高手", iconPath: homeIcon, selectedIconPath: homeIcon });
    wx.setTabBarItem({ index: 2, text: role === "provider" ? "档期" : "项目", iconPath: thirdIcon, selectedIconPath: thirdIcon });
  },

  switchIdentity() {
    const nextRole = this.data.role === "provider" ? "buyer" : "provider";
    wx.setStorageSync("animeMasterRole", nextRole);
    wx.switchTab({ url: "/pages/discover/index" });
  },

  editAccount() { wx.navigateTo({ url: `/pages/account-profile/index?role=${this.data.role}` }); },
  openAssets(event) { wx.navigateTo({ url: `/pages/me-assets/index?type=${event.currentTarget.dataset.type}` }); },
  uploadWork() {
    wx.setStorageSync("animeMasterRole", "provider");
    chooseWorkMedia({
      count: 5,
      success: ({ tempFiles }) => {
        if (!tempFiles || !tempFiles.length) return;
        pendingWorkUpload.stage(tempFiles);
        wx.navigateTo({
          url: `/pages/provider-profile/index?edit=1&section=works${this.auditMode ? "&audit=1" : ""}`,
          fail: () => pendingWorkUpload.clear()
        });
      }
    });
  },
  editStorefront() {
    wx.setStorageSync("animeMasterRole", "provider");
    wx.navigateTo({ url: `/pages/provider-profile/index?edit=1&section=profile${this.auditMode ? "&audit=1" : ""}` });
  },
  openFunds() { wx.navigateTo({ url: "/pages/funds/index" }); },
  previewStorefront() { wx.navigateTo({ url: `/pages/provider-detail/index?id=${this.serverAccountId || store.CURRENT_PROVIDER_ID}&workspace=provider${this.auditMode ? "&audit=1" : ""}` }); },
  openBuyerOrders() { wx.switchTab({ url: "/pages/orders/index" }); },
  openBuyerProjects() { wx.switchTab({ url: "/pages/projects/index" }); }
});
