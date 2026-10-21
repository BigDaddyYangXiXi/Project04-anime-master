const localPreview = require("../../utils/local-preview");
const { findProvider, findWork } = require("../../data/catalog");
const store = require("../../data/v063-store");
const cloudSavedItems = require("../../services/cloud-saved-items");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudOrders = require("../../services/cloud-orders");

const meta = {
  followed: { title: "我的关注", empty: "还没有关注服务者" },
  liked: { title: "我的喜欢", empty: "还没有喜欢的作品" },
  referenced: { title: "参考作品", empty: "订单中还没有参考作品" }
};

Page({
  data: { title: "我的内容", empty: "暂无内容", items: [], loading: false, loadError: "", navWorkspace: "buyer" },
  onLoad(options) {
    this.unloaded = false;
    this.assetsRequestId = (this.assetsRequestId || 0) + 1;
    this.type = meta[options.type] ? options.type : "followed";
    this.cloudMode = !localPreview.isAudit(options);
    const navWorkspace = wx.getStorageSync("animeMasterRole") === "provider" ? "provider" : "buyer";
    this.setData({ navWorkspace });
  },
  onShow() {
    if (this.cloudMode) { this.loadCloud(); return; }
    const config = meta[this.type];
    let items = [];
    if (this.type === "followed") items = (wx.getStorageSync("v063-followed-providers") || []).map(findProvider).filter(Boolean).map((item) => ({ id: item.id, kind: "provider", title: item.name, subtitle: `${item.career} · ${item.city}`, meta: `${item.rating} 分` }));
    if (this.type === "liked") items = (wx.getStorageSync("anime-master-v063-liked-work-ids") || []).map((id) => findWork(id) || store.getWorks().find((work) => work.id === id)).filter(Boolean).map((item) => ({ id: item.id, kind: "work", title: item.title, subtitle: item.subtitle || "公开作品", meta: item.code }));
    if (this.type === "referenced") {
      const ids = Array.from(new Set(store.getOrders().filter((order) => order.buyerId === store.CURRENT_BUYER_ID).map((order) => order.bookingDraft && order.bookingDraft.workId).filter(Boolean)));
      items = ids.map((id) => findWork(id) || store.getWorks().find((work) => work.id === id)).filter(Boolean).map((item) => ({ id: item.id, kind: "work", title: item.title, subtitle: item.subtitle || "已用于预约", meta: item.code }));
    }
    this.setData({ title: config.title, empty: config.empty, items: items.map(item => ({ ...item, key: `${item.kind}:${item.providerId || ""}:${item.id}` })) });
  },
  async loadCloud() {
    if (this.unloaded) return;
    const requestId = this.assetsRequestId = (this.assetsRequestId || 0) + 1;
    const config = meta[this.type]; this.setData({ title: config.title, empty: config.empty, loading: true, loadError: "" });
    try {
      const [saved, orders] = await Promise.all([
        this.type === "referenced" ? null : cloudSavedItems.listMine(),
        this.type === "referenced" ? cloudOrders.listOrders() : []
      ]);
      if (requestId !== this.assetsRequestId) return;
      const hasItems = this.type === "followed" ? saved.providerIds.length > 0
        : this.type === "liked" ? saved.workIds.length > 0
          : orders.some(order => order.viewerRole === "BUYER" && order.providerId && order.referenceWorkId);
      if (!hasItems) { this.setData({ items: [], loading: false }); return; }
      const catalog = await cloudCatalog.listProviders();
      if (requestId !== this.assetsRequestId) return;
      const providers = catalog.providers || []; const works = providers.flatMap((provider) => provider.works || []);
      const uniqueWork = id => {
        const matches = works.filter(work => work.id === id);
        return matches.length === 1 ? matches[0] : null;
      };
      let items = [];
      if (this.type === "followed") items = saved.providerIds.map((id) => providers.find((item) => item.id === id)).filter(Boolean).map((item) => ({ id: item.id, kind: "provider", title: item.nickname, subtitle: `${item.career} · ${item.city}`, meta: "已关注" }));
      if (this.type === "liked") items = saved.workIds.map(uniqueWork).filter(Boolean).map((item) => ({ id: item.id, providerId: item.providerId, kind: "work", title: item.title, subtitle: item.subtitle || "公开作品", meta: item.code }));
      if (this.type === "referenced") {
        const references = new Map(orders.filter(order => order.viewerRole === "BUYER" && order.providerId && order.referenceWorkId)
          .map(order => [`${order.providerId}:${order.referenceWorkId}`, order]));
        items = [...references.values()].map(order => {
          const matches = works.filter(work => work.id === order.referenceWorkId && work.providerId === order.providerId);
          return matches.length === 1 ? matches[0] : null;
        }).filter(Boolean).map((item) => ({ id: item.id, providerId: item.providerId, kind: "work", title: item.title, subtitle: item.subtitle || "已用于预约", meta: item.code }));
      }
      this.setData({ items: items.map(item => ({ ...item, key: `${item.kind}:${item.providerId || ""}:${item.id}` })), loading: false });
    } catch (error) { if (requestId === this.assetsRequestId) this.setData({ items: [], loading: false, loadError: "内容资产读取失败，请稍后重试。" }); }
  },
  retryLoad() {
    if (this.unloaded || this.data.loading) return;
    return this.loadCloud();
  },
  onUnload() { this.unloaded = true; this.assetsRequestId = (this.assetsRequestId || 0) + 1; },
  openItem(event) {
    const { id, kind, providerId } = event.currentTarget.dataset;
    const workspace = this.data.navWorkspace === "provider" ? "&workspace=provider" : "";
    const matches = this.data.items.filter(item => item.id === id && item.kind === kind && (!providerId || item.providerId === providerId));
    if (matches.length !== 1) return;
    const item = matches[0];
    const owner = item && item.providerId ? `&providerId=${encodeURIComponent(item.providerId)}` : "";
    wx.navigateTo({ url: kind === "provider" ? `/pages/provider-detail/index?id=${encodeURIComponent(id)}${workspace}` : `/pages/work-detail/index?id=${encodeURIComponent(id)}${owner}${workspace}` });
  }
});
