const store = require("../../data/v063-store");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

const tabs = Object.keys(presentation.groupMeta).map((id) => ({ id, label: presentation.groupMeta[id].label }));
function normalizeGroup(value) { return value === "production" || value === "acceptance" ? "execution" : presentation.orderGroups[value] ? value : "booking"; }

Page({
  data: { group: "booking", tabs, orders: [], loading: false, loadError: "" },
  onLoad(options) {
    this.auditMode = options.audit === "1";
    this.auditEmpty = options.audit === "1" && options.empty === "1";
    this.setData({ group: normalizeGroup(options.group || options.flow) });
  },
  onShow() { this.refresh(); },
  async refresh() {
    const stages = presentation.orderGroups[this.data.group];
    if (!this.auditMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        const allOrders = await cloudOrders.listOrders();
        this.allOrders = allOrders;
        const orders = allOrders.filter((order) => order.viewerRole === "PROVIDER" && stages.includes(order.stage))
          .map((order) => presentation.enrichOrder(order, "buyer"));
        this.setData({ orders, loading: false });
      } catch (error) {
        this.setData({ orders: [], loading: false, loadError: "订单加载失败，请检查网络后重试。" });
      }
      return;
    }
    const orders = this.auditEmpty ? [] : store.getOrders()
      .filter((order) => order.providerId === store.CURRENT_PROVIDER_ID && stages.includes(order.stage))
      .map((order) => presentation.enrichOrder(order, "buyer"));
    this.setData({ orders });
  },
  retryLoad() { this.refresh(); },
  choose(event) { this.setData({ group: normalizeGroup(event.currentTarget.dataset.group || event.currentTarget.dataset.flow) }, () => this.refresh()); },
  open(event) {
    const order = !this.auditMode
      ? (this.allOrders || []).find((item) => item.id === event.currentTarget.dataset.id)
      : store.findOrder(event.currentTarget.dataset.id);
    if (!order) return;
    const page = order.stage === "NDA_PROVIDER_PENDING" ? "provider-task" : "provider-request";
    wx.navigateTo({ url: `/pages/${page}/index?id=${order.id}` });
  }
});

module.exports = { normalizeGroup };
