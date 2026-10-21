const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

const tabs = Object.keys(presentation.groupMeta).map((id) => ({ id, label: presentation.groupMeta[id].label }));
function normalizeGroup(value) { return value === "production" || value === "acceptance" ? "execution" : presentation.orderGroups[value] ? value : "booking"; }

Page({
  data: { group: "booking", tabs, orders: [], ready: false, loading: false, loadError: "" },
  onLoad(options) {
    this.auditMode = localPreview.isAudit(options);
    this.auditEmpty = localPreview.isAudit(options) && options.empty === "1";
    this.setData({ group: normalizeGroup(options.group || options.flow) });
  },
  onShow() { this.refresh(); },
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
      const role = "provider";
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
        const orders = allOrders.filter((order) => order.viewerRole === "PROVIDER" && stages.includes(order.stage))
          .map((order) => presentation.enrichOrder(order, "buyer"));
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
      .filter((order) => order.providerId === store.CURRENT_PROVIDER_ID && stages.includes(order.stage))
      .map((order) => presentation.enrichOrder(order, "buyer"));
    this.setData({ orders, ready: true });
  },
  retryLoad() { this.refresh(); },
  choose(event) { this.setData({ group: normalizeGroup(event.currentTarget.dataset.group || event.currentTarget.dataset.flow) }, () => this.refresh()); },
  open(event) {
    if (this.unloaded || !this.currentAccount()) return;
    const order = !this.auditMode
      ? (this.allOrders || []).find((item) => item.id === event.currentTarget.dataset.id)
      : store.findOrder(event.currentTarget.dataset.id);
    if (!order) return;
    const page = order.stage === "NDA_PROVIDER_PENDING" ? "provider-task" : "provider-request";
    wx.navigateTo({ url: `/pages/${page}/index?id=${order.id}` });
  }
});

module.exports = { normalizeGroup };
