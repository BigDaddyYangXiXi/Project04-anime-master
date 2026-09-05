const { findProvider, findWork } = require("../../data/catalog");
const store = require("../../data/v063-store");
const cloudSavedItems = require("../../services/cloud-saved-items");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudOrders = require("../../services/cloud-orders");

const meta = {
  followed: { title: "我的关注", empty: "还没有关注服务者" },
  liked: { title: "我的喜欢", empty: "还没有喜欢的作品" },
  referenced: { title: "引用作品", empty: "订单中还没有引用作品" }
};

Page({
  data: { title: "我的内容", empty: "暂无内容", items: [], loading: false, loadError: "", navWorkspace: "buyer" },
  onLoad(options) {
    this.type = meta[options.type] ? options.type : "followed";
    this.cloudMode = options.audit !== "1";
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
    this.setData({ title: config.title, empty: config.empty, items });
  },
  async loadCloud() {
    const config = meta[this.type]; this.setData({ title: config.title, empty: config.empty, loading: true, loadError: "" });
    try {
      const [saved, catalog, orders] = await Promise.all([cloudSavedItems.listMine(), cloudCatalog.listProviders(), cloudOrders.listOrders()]);
      const providers = catalog.providers || []; const works = providers.flatMap((provider) => provider.works || []);
      let items = [];
      if (this.type === "followed") items = saved.providerIds.map((id) => providers.find((item) => item.id === id)).filter(Boolean).map((item) => ({ id: item.id, kind: "provider", title: item.nickname, subtitle: `${item.career} · ${item.city}`, meta: "已关注" }));
      if (this.type === "liked") items = saved.workIds.map((id) => works.find((item) => item.id === id)).filter(Boolean).map((item) => ({ id: item.id, kind: "work", title: item.title, subtitle: item.subtitle || "公开作品", meta: item.code }));
      if (this.type === "referenced") {
        const ids = [...new Set(orders.filter((order) => order.viewerRole === "BUYER").map((order) => order.referenceWorkId).filter(Boolean))];
        items = ids.map((id) => works.find((item) => item.id === id)).filter(Boolean).map((item) => ({ id: item.id, kind: "work", title: item.title, subtitle: item.subtitle || "已用于预约", meta: item.code }));
      }
      this.setData({ items, loading: false });
    } catch (error) { this.setData({ items: [], loading: false, loadError: "内容资产读取失败，请稍后重试。" }); }
  },
  openItem(event) {
    const { id, kind } = event.currentTarget.dataset;
    const workspace = this.data.navWorkspace === "provider" ? "&workspace=provider" : "";
    wx.navigateTo({ url: kind === "provider" ? `/pages/provider-detail/index?id=${id}${workspace}` : `/pages/work-detail/index?id=${id}${workspace}` });
  }
});
