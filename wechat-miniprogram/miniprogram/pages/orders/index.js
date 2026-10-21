const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

const tabs = Object.keys(presentation.groupMeta).map((id) => ({ id, label: presentation.groupMeta[id].label }));
const ROOT_ORDER_GROUP_KEY = "anime-master-root-order-group";

function normalizeGroup(value) {
  return value === "production" || value === "acceptance" ? "execution" : presentation.orderGroups[value] ? value : "booking";
}

function destinationFor(stage) {
  if (stage === "DELIVERY_PENDING") return "fulfillment";
  if (presentation.groupForStage(stage) === "booking") return "booking-status";
  return "order-detail";
}

Page({
  data: { role: "buyer", group: "booking", tabs, orders: [], ready: false, loading: false, loadError: "" },
  onLoad(options) {
    this.auditMode = localPreview.isAudit(options);
    this.auditEmpty = localPreview.isAudit(options) && options.empty === "1";
    this.setData({ group: normalizeGroup(options.group || options.flow) });
  },
  onShow() {
    const role = wx.getStorageSync("animeMasterRole") === "provider" ? "provider" : "buyer";
    this.syncNativeTabBar(role);
    const pendingGroup = wx.getStorageSync(ROOT_ORDER_GROUP_KEY);
    if (pendingGroup && wx.removeStorageSync) wx.removeStorageSync(ROOT_ORDER_GROUP_KEY);
    this.setData({ role, group: pendingGroup ? normalizeGroup(pendingGroup) : this.data.group }, () => {
      this.refresh();
    });
  },
  syncNativeTabBar(role) {
    if (!wx.setTabBarItem) return;
    const homeIcon = role === "provider" ? "/assets/nav/workbench-line.png" : "/assets/nav/market-line.png";
    const thirdIcon = role === "provider" ? "/assets/nav/calendar-line.png" : "/assets/nav/project-line.png";
    wx.setTabBarItem({ index: 0, text: role === "provider" ? "工作台" : "找高手", iconPath: homeIcon, selectedIconPath: homeIcon.replace(".png", "-active.png") });
    wx.setTabBarItem({ index: 2, text: role === "provider" ? "档期" : "项目", iconPath: thirdIcon, selectedIconPath: thirdIcon.replace(".png", "-active.png") });
  },
  onUnload() { this.unloaded = true; this.loadRequest = (this.loadRequest || 0) + 1; },
  currentAccount() {
    if (this.auditMode) return true;
    if (this.accountId && this.accountId === getApp().globalData.account?.id) return true;
    this.allOrders = [];
    this.setData({ orders: [], ready: false, loading: false, loadError: "账号已变化，请重新读取订单。" });
    return false;
  },
  async refresh() {
    if (this.unloaded) return;
    const request = this.loadRequest = (this.loadRequest || 0) + 1;
    const stages = presentation.orderGroups[this.data.group];
    if (!this.auditMode) {
      const accountId = getApp().globalData.account?.id;
      const role = this.data.role;
      if (this.accountId !== accountId || this.listRole !== role || this.listGroup !== this.data.group) {
        this.allOrders = [];
        this.setData({ orders: [], ready: false });
      }
      this.accountId = accountId;
      this.listRole = role;
      this.listGroup = this.data.group;
      if (!this.currentAccount()) return;
      this.setData({ loading: true, loadError: "" });
      try {
        const allOrders = await cloudOrders.listOrders();
        if (request !== this.loadRequest || !this.currentAccount()) return;
        this.allOrders = allOrders;
        const viewerRole = this.data.role === "provider" ? "PROVIDER" : "BUYER";
        const orders = allOrders.filter((order) => order.viewerRole === viewerRole && stages.includes(order.stage))
          .map((order) => presentation.enrichOrder(order, this.data.role === "provider" ? "buyer" : "provider"));
        this.setData({ orders, ready: true, loading: false });
      } catch (error) {
        if (request !== this.loadRequest || !this.currentAccount()) return;
        const keepOrders = this.data.ready && !error?.code && /^cloud\.callFunction:fail/.test(error?.errMsg || "");
        if (!keepOrders) this.allOrders = [];
        this.setData({ ...(keepOrders ? {} : { orders: [], ready: false }), loading: false,
          loadError: keepOrders ? "刷新失败，当前显示上次读取的订单，请重试。" : "订单读取失败，请重试。" });
      }
      return;
    }
    const orders = this.auditEmpty ? [] : store.getOrders()
      .filter((order) => (this.data.role === "provider" ? order.providerId === store.CURRENT_PROVIDER_ID : order.buyerId === store.CURRENT_BUYER_ID) && stages.includes(order.stage))
      .map((order) => presentation.enrichOrder(order, this.data.role === "provider" ? "buyer" : "provider"));
    this.setData({ orders, ready: true });
  },
  retryLoad() { this.refresh(); },
  choose(event) { this.setData({ group: event.currentTarget.dataset.group }, () => this.refresh()); },
  open(event) {
    if (this.unloaded || !this.currentAccount()) return;
    const order = !this.auditMode
      ? (this.allOrders || []).find((item) => item.id === event.currentTarget.dataset.id)
      : store.findOrder(event.currentTarget.dataset.id);
    if (!order) return;
    if (this.data.role === "provider") {
      const page = order.stage === "NDA_PROVIDER_PENDING" ? "provider-task" : "provider-request";
      wx.navigateTo({ url: `/pages/${page}/index?id=${order.id}` });
      return;
    }
    wx.navigateTo({ url: `/pages/${destinationFor(order.stage)}/index?id=${order.id}` });
  }
});

module.exports = { destinationFor, normalizeGroup, ROOT_ORDER_GROUP_KEY };
