const store = require("../../data/v063-store");
const { stageLabels } = require("../../data/v063");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

Page({
  data: { order: null, statusLabel: "", canSign: false, signIssues: [], waitingBuyer: false, finalConfirm: false, buyerIdentity: null, schedule: { mode: "", lines: [] }, loading: false, loadError: "", actionPending: false },
  onLoad(options) {
    this.orderId = options.id;
    this.auditState = options.audit === "1" ? options.state : "";
    this.cloudMode = options.audit !== "1";
  },
  onShow() { this.load(); },
  async load() {
    if (this.cloudMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        const order = await cloudOrders.getOrder(this.orderId);
        this.renderOrder(order);
        this.setData({ loading: false });
      } catch (error) {
        this.setData({ order: null, loading: false, loadError: "订单加载失败，请稍后重试。" });
      }
      return;
    }
    let order = store.findOrder(this.orderId);
    if (!order) return this.setData({ order: null });
    this.renderOrder(order);
  },
  renderOrder(sourceOrder) {
    let order = sourceOrder;
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
    wx.showModal({
      title: "确认签署保密协议",
      content: "确认后会记录服务方已签署，并将订单交回需求方做最终执行确认。当前原型不生成法律电子签章。",
      confirmColor: "#c6536b",
      success: ({ confirm }) => {
        if (!confirm) return;
        if (this.cloudMode) {
          if (this.data.actionPending) return;
          this.setData({ actionPending: true });
          cloudOrders.transitionOrder(this.orderId, this.data.order.version, "PROVIDER_SIGNS_NDA")
            .then((order) => { this.renderOrder(order); this.setData({ actionPending: false, loadError: "" }); })
            .catch((error) => {
              this.setData({ actionPending: false, loadError: error && error.code === "VERSION_CONFLICT" ? "订单状态已变化，正在刷新。" : "签署失败，请稍后重试。" });
              if (error && error.code === "VERSION_CONFLICT") this.load();
            });
          return;
        }
        store.applyEvent(this.orderId, "PROVIDER_SIGNS_NDA", { providerNdaSigned: true });
        this.load();
      }
    });
  },
  retryLoad() { this.load(); }
});
