const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const { stageLabels } = require("../../data/v063");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

const AUDIT_STAGES = {
  buyer: "NDA_BUYER_PENDING", provider: "NDA_PROVIDER_PENDING", final: "BUYER_FINAL_CONFIRM",
  production: "IN_PRODUCTION", revision: "REVISION_REQUESTED", completed: "COMPLETED"
};

Page({
  openReference: require("../../utils/order-reference-preview"),
  data: {
    order: null, statusLabel: "", ndaText: "未确认",
    canBuyerSign: false, signIssues: [], waitingProvider: false, canConfirm: false, confirmIssues: [],
    bookingInProgress: false, inProduction: false, completed: false,
    providerIdentity: null, schedule: { mode: "", lines: [] }, loading: false, loadError: ""
  },
  onLoad(options) {
    this.orderId = options.id;
    this.auditStage = localPreview.isAudit(options) ? AUDIT_STAGES[options.state] : "";
    this.cloudMode = !localPreview.isAudit(options);
  },
  onShow() { this.load(); },
  onUnload() { this.loadRequest = (this.loadRequest || 0) + 1; },
  async load() {
    if (this.cloudMode) {
      const request = this.loadRequest = (this.loadRequest || 0) + 1;
      const visibleOrder = this.data.order;
      this.setData({ loading: true, loadError: "" });
      try {
        const order = await cloudOrders.getOrder(this.orderId);
        if (request !== this.loadRequest) return;
        this.renderOrder(order);
      } catch (error) {
        if (request === this.loadRequest && this.data.order === visibleOrder) {
          this.setData({ order: null, loadError: this.cloudErrorMessage(error) });
        }
      } finally {
        if (request === this.loadRequest) this.setData({ loading: false });
      }
      return;
    }
    let order = store.findOrder(this.orderId);
    if (!order) return this.setData({ order: null });
    this.renderOrder(order);
  },
  renderOrder(sourceOrder) {
    if (sourceOrder.cloudOrder && this.data.order && this.data.order.id === sourceOrder.id
      && Number(this.data.order.version) > Number(sourceOrder.version)) return false;
    let order = sourceOrder;
    if (this.auditStage) {
      order = Object.assign({}, order, {
        stage: this.auditStage,
        communicationDone: true,
        ndaRequired: ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(this.auditStage),
        executable: true,
        buyerNdaSigned: this.auditStage !== "NDA_BUYER_PENDING",
        providerNdaSigned: ["BUYER_FINAL_CONFIRM", "IN_PRODUCTION", "REVISION_REQUESTED", "COMPLETED"].includes(this.auditStage),
        progress: this.auditStage === "REVISION_REQUESTED" ? 78 : 45
      });
    }
    const signIssues = [];
    if (order.stage === "NDA_BUYER_PENDING") {
      if (order.ndaFlowVersion !== 2 && !order.communicationDone) signIssues.push("等待双方确认沟通完毕");
      if (order.ndaFlowVersion !== 2 && !order.executable) signIssues.push("等待服务方确认可以履约");
      if (order.ndaRequired !== true) signIssues.push("订单尚未确认需要保密协议");
    }
    const confirmIssues = [];
    if (order.stage === "BUYER_FINAL_CONFIRM") {
      if (!order.communicationDone) confirmIssues.push("双方尚未确认沟通完毕");
      if (!order.executable) confirmIssues.push("服务方尚未确认可以履约");
      if (order.ndaRequired === true && !order.buyerNdaSigned) confirmIssues.push("需求方尚未签署保密协议");
      if (order.ndaRequired === true && !order.providerNdaSigned) confirmIssues.push("服务方尚未签署保密协议");
    }
    this.setData({
      order,
      providerIdentity: presentation.providerIdentity(order), schedule: presentation.scheduleFor(order),
      statusLabel: stageLabels[order.stage],
      ndaText: order.ndaRequired === null ? "未确认" : order.ndaRequired ? "需要签署 NDA" : "无保密义务",
      bookingInProgress: ["REQUESTED", "SUPPLEMENT_REQUESTED", "SUPPLEMENTED", "CONTACTING", "NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM"].includes(order.stage),
      canBuyerSign: false,
      signIssues,
      waitingProvider: order.stage === "NDA_PROVIDER_PENDING",
      canConfirm: false,
      confirmIssues,
      inProduction: ["IN_PRODUCTION", "REVISION_REQUESTED"].includes(order.stage),
      completed: order.stage === "COMPLETED"
    });
  },
  retryLoad() { this.load(); },
  cloudErrorMessage(error) {
    if (error && error.code === "ORDER_NOT_FOUND") return "没有找到这笔订单。";
    return "订单读取失败，请稍后重试。";
  },
  signNda() {
    this.goBookingStatus();
  },
  confirmExecution() {
    this.goBookingStatus();
  },
  goBookingStatus() { wx.redirectTo({ url: `/pages/booking-status/index?id=${this.orderId}` }); },
  goRefund() {
    const order = this.data.order;
    if (order?.cloudOrder && order.viewerRole === 'BUYER' && order.paymentStatus === 'PAID') wx.navigateTo({url:`/pages/order-refund/index?id=${encodeURIComponent(this.orderId)}`});
  },
  goReview() { wx.navigateTo({ url: `/pages/review/index?id=${this.orderId}` }); },
  goDelivery() { wx.navigateTo({ url: `/pages/fulfillment/index?id=${this.orderId}` }); },
  goProject() { wx.switchTab({ url: "/pages/projects/index" }); }
});
