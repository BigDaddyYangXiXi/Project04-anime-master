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
  data: { role: "buyer", group: "booking", tabs, orders: [], loading: false, loadError: "" },
  onLoad(options) {
    this.auditMode = options.audit === "1";
    this.auditEmpty = options.audit === "1" && options.empty === "1";
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
    const homeIcon = role === "provider" ? "/assets/nav/workbench-tab.png" : "/assets/nav/market-tab.png";
    const thirdIcon = role === "provider" ? "/assets/nav/calendar-tab.png" : "/assets/nav/project-tab.png";
    wx.setTabBarItem({ index: 0, text: role === "provider" ? "工作台" : "找高手", iconPath: homeIcon, selectedIconPath: homeIcon });
    wx.setTabBarItem({ index: 2, text: role === "provider" ? "档期" : "项目", iconPath: thirdIcon, selectedIconPath: thirdIcon });
  },
  async refresh() {
    const stages = presentation.orderGroups[this.data.group];
    if (!this.auditMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        const allOrders = await cloudOrders.listOrders();
        this.allOrders = allOrders;
        const viewerRole = this.data.role === "provider" ? "PROVIDER" : "BUYER";
        const orders = allOrders.filter((order) => order.viewerRole === viewerRole && stages.includes(order.stage))
          .map((order) => presentation.enrichOrder(order, this.data.role === "provider" ? "buyer" : "provider"));
        this.setData({ orders, loading: false });
      } catch (error) {
        this.setData({ orders: [], loading: false, loadError: "订单加载失败，请检查网络后重试。" });
      }
      return;
    }
    const orders = this.auditEmpty ? [] : store.getOrders()
      .filter((order) => (this.data.role === "provider" ? order.providerId === store.CURRENT_PROVIDER_ID : order.buyerId === store.CURRENT_BUYER_ID) && stages.includes(order.stage))
      .map((order) => presentation.enrichOrder(order, this.data.role === "provider" ? "buyer" : "provider"));
    this.setData({ orders });
  },
  retryLoad() { this.refresh(); },
  choose(event) { this.setData({ group: event.currentTarget.dataset.group }, () => this.refresh()); },
  open(event) {
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
