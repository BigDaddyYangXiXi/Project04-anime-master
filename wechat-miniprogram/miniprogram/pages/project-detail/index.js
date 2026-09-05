const store = require("../../data/v063-store");
const projectModel = require("../../data/project-model");
const { stageLabels, stageFlows } = require("../../data/v063");
const cloudProjects = require("../../services/cloud-projects");
const cloudOrders = require("../../services/cloud-orders");

function flowFor(stage) { return Object.keys(stageFlows).find((flow) => stageFlows[flow].includes(stage)) || "booking"; }
function destinationFor(stage) { if (flowFor(stage) === "acceptance") return "fulfillment"; if (flowFor(stage) === "booking") return "booking-status"; return "order-detail"; }
function formatProjectDescription(value) {
  const content = String(value || "").trim() || "此前没有可读取的项目描述，请补充。";
  return content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const matched = line.match(/^([^：:]{2,8})[：:]\s*(.*)$/);
    return matched ? { label: matched[1], text: matched[2] || "待补充" } : { label: "", text: line };
  });
}

Page({
  data: {
    project: null, descriptionRows: [], linkedOrders: [], availableOrders: [], selectingOrder: false,
    orderCount: 0, ndaPending: 0, total: 0, loading: false, loadError: "", actionPending: false
  },
  onLoad(options) { this.projectId = options.id; this.cloudMode = options.audit !== "1"; },
  onShow() { this.load(); },
  async load() {
    if (this.cloudMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        const [project, orders] = await Promise.all([cloudProjects.getProject(this.projectId), cloudOrders.listOrders()]);
        this.renderProject(project, orders.filter((order) => order.viewerRole === "BUYER"));
        this.setData({ loading: false });
      } catch (error) {
        this.setData({ project: null, loading: false, loadError: error && error.code === "PROJECT_NOT_FOUND" ? "没有找到这个项目。" : "项目读取失败，请稍后重试。" });
      }
      return;
    }
    const project = projectModel.getProjects().find((item) => item.id === this.projectId);
    if (project) this.renderProject(project, store.getOrders().filter((item) => item.buyerId === store.CURRENT_BUYER_ID && item.stage !== "DECLINED"));
  },
  renderProject(project, buyerOrders) {
    const bookingIds = Array.isArray(project.bookingIds) ? project.bookingIds : [];
    const linkedOrders = buyerOrders.filter((item) => bookingIds.includes(item.id) && item.stage !== "DECLINED").map((item) => ({
      orderId: item.id, career: item.career || "未设置职业", provider: item.provider || "待确认服务方",
      providerUid: item.providerUid || item.providerId || "", service: item.service || item.title || "服务内容待确认",
      state: stageLabels[item.stage] || item.stage, stage: item.stage, amount: Number(item.finalPrice || 0)
    }));
    const availableOrders = buyerOrders.filter((item) => projectModel.EXECUTION_STAGES.includes(item.stage) && !bookingIds.includes(item.id)).map((item) => ({
      orderId: item.id, career: item.career || "未设置职业", provider: item.provider || "待确认服务方",
      service: item.service || item.title || "服务内容待确认", state: stageLabels[item.stage] || item.stage
    }));
    this.setData({
      project, descriptionRows: formatProjectDescription(project.description), linkedOrders, availableOrders,
      orderCount: linkedOrders.length,
      ndaPending: linkedOrders.filter((item) => ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(item.stage)).length,
      total: linkedOrders.reduce((sum, item) => sum + item.amount, 0)
    });
  },
  openOrder(event) { const order = this.data.linkedOrders[Number(event.currentTarget.dataset.index)]; if (order) wx.navigateTo({ url: `/pages/${destinationFor(order.stage)}/index?id=${order.orderId}` }); },
  addOrder() {
    if (!this.data.availableOrders.length) return wx.showToast({ title: "暂无可添加的执行中订单", icon: "none" });
    this.setData({ selectingOrder: !this.data.selectingOrder });
  },
  async linkOrder(event) {
    const order = this.data.availableOrders[Number(event.currentTarget.dataset.index)];
    if (!order || this.data.actionPending) return;
    if (this.cloudMode) {
      this.setData({ actionPending: true });
      try { await cloudProjects.linkOrder(this.projectId, this.data.project.version, order.orderId); this.setData({ selectingOrder: false, actionPending: false }); await this.load(); }
      catch (error) { this.setData({ actionPending: false }); wx.showToast({ title: error && error.code === "VERSION_CONFLICT" ? "项目已变化，正在刷新" : "订单暂时不能加入项目", icon: "none" }); await this.load(); }
      return;
    }
    if (!projectModel.linkOrder(this.projectId, order.orderId)) return wx.showToast({ title: "订单状态已变化，请刷新后重试", icon: "none" });
    this.setData({ selectingOrder: false }); this.load();
  },
  unlinkOrder(event) {
    const order = this.data.linkedOrders[Number(event.currentTarget.dataset.index)]; if (!order) return;
    wx.showModal({ title: "移出项目？", content: "只解除项目归组，不会取消订单或改变订单执行状态。", confirmText: "确认移出", confirmColor: "#c6536b", success: async ({ confirm }) => {
      if (!confirm || this.data.actionPending) return;
      if (this.cloudMode) {
        this.setData({ actionPending: true });
        try { await cloudProjects.unlinkOrder(this.projectId, this.data.project.version, order.orderId); this.setData({ actionPending: false }); await this.load(); }
        catch { this.setData({ actionPending: false }); wx.showToast({ title: "项目已变化，正在刷新", icon: "none" }); await this.load(); }
      } else if (projectModel.unlinkOrder(this.projectId, order.orderId)) this.load();
    } });
  },
  openBrief() { wx.navigateTo({ url: `/pages/brief/index?id=${this.projectId}` }); },
  previewTargetImage(event) { const images = this.data.project && this.data.project.targetImages || []; const current = images[Number(event.currentTarget.dataset.index)]; if (current) wx.previewImage({ current, urls: images }); },
  retryLoad() { this.load(); }
});

module.exports = { flowFor, destinationFor, formatProjectDescription };
