const confirmAction = require("../../utils/order-confirmation");
const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const { stageLabels } = require("../../data/v063");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

Page({
  data: { order: null, statusLabel: "", canSign: false, signIssues: [], waitingBuyer: false, finalConfirm: false, buyerIdentity: null, schedule: { mode: "", lines: [] }, loading: false, loadError: "", actionPending: false },
  onLoad(options) {
    this.orderId = options.id;
    this.auditState = localPreview.isAudit(options) ? options.state : "";
    this.cloudMode = !localPreview.isAudit(options);
  },
  onShow() { this.load(); },
  onUnload() { this.unloaded = true; this.loadRequest = (this.loadRequest || 0) + 1; },
  async load() {
    if (this.unloaded) return;
    const request = this.loadRequest = (this.loadRequest || 0) + 1;
    const visibleOrder = this.data.order;
    if (this.cloudMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        const order = await cloudOrders.getOrder(this.orderId);
        if (request !== this.loadRequest) return;
        this.renderOrder(order);
        this.setData({ loading: false });
      } catch (error) {
        if (request !== this.loadRequest) return;
        if (this.data.order !== visibleOrder) { this.setData({ loading: false }); return; }
        this.setData({ order: null, loading: false, loadError: "订单加载失败，请稍后重试。" });
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
    let order = presentation.providerOrderView(sourceOrder);
    if (this.auditState) {
      order = Object.assign({}, order);
      if (this.auditState === "buyer") Object.assign(order, { stage: "NDA_BUYER_PENDING", ndaRequired: true, buyerNdaSigned: false, providerNdaSigned: false });
      if (this.auditState === "provider") Object.assign(order, { stage: "NDA_PROVIDER_PENDING", ndaRequired: true, buyerNdaSigned: true, providerNdaSigned: false });
      if (this.auditState === "final") Object.assign(order, { stage: "BUYER_FINAL_CONFIRM", ndaRequired: true, buyerNdaSigned: true, providerNdaSigned: true });
    }
    const signIssues = [];
    if (order.stage === "NDA_PROVIDER_PENDING") {
      if (order.ndaRequired !== true) signIssues.push("订单尚未确认需要保密协议");
      if (!order.buyerNdaSigned) signIssues.push("等待需求方先完成签署");
      if (order.providerNdaSigned) signIssues.push("服务方已经完成签署");
    }
    this.setData({
      order, statusLabel: stageLabels[order.stage], buyerIdentity: presentation.buyerIdentity(order), schedule: presentation.scheduleFor(order),
      canSign: order.stage === "NDA_PROVIDER_PENDING" && signIssues.length === 0,
      signIssues,
      waitingBuyer: order.stage === "NDA_BUYER_PENDING",
      finalConfirm: order.stage === "BUYER_FINAL_CONFIRM"
    });
  },
  sign() {
    if (!this.data.canSign || this.auditState) return;
    confirmAction(this, "确认签署保密协议", "确认后记录本次签署。双方签署完成后可查看保密需求，再沟通并确认合作条件。当前不生成法律电子签章。", () => {
        if (this.cloudMode) {
          if (this.data.actionPending) return;
          this.setData({ actionPending: true });
          cloudOrders.transitionOrder(this.orderId, this.data.order.version, "PROVIDER_SIGNS_NDA")
            .then((order) => { if (this.unloaded) return; this.renderOrder(order); this.setData({ actionPending: false, loadError: "" }); })
            .catch((error) => {
              if (this.unloaded) return;
              this.setData({ actionPending: false, loadError: error && error.code === "VERSION_CONFLICT" ? "订单状态已变化，正在刷新。" : "签署失败，请稍后重试。" });
              if (error && error.code === "VERSION_CONFLICT") this.load();
            });
          return;
        }
        store.applyEvent(this.orderId, "PROVIDER_SIGNS_NDA", { providerNdaSigned: true });
        this.load();
    });
  },
  continueCommunication() {
    wx.navigateTo({ url: `/pages/provider-request/index?id=${this.orderId}`,
      fail: () => wx.showToast({ title: "页面未能打开，请重试", icon: "none" }) });
  },
  retryLoad() { this.load(); }
});
