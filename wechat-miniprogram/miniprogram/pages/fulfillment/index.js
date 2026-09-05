const store = require("../../data/v063-store");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

Page({
  data: {
    order: null, onsite: false, validStage: false, revision: "", canRevise: false, canAccept: false,
    acceptIssues: [], providerIdentity: null, schedule: { mode: "", lines: [] },
    loading: false, loadError: "", actionPending: false
  },

  onLoad(options) {
    this.orderId = options.id;
    this.auditRevision = options.audit === "1" && options.revision === "1";
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
        this.setData({ order: null, loading: false, loadError: this.cloudErrorMessage(error) });
      }
      return;
    }
    this.renderOrder(store.findOrder(this.orderId));
  },

  renderOrder(order) {
    const revision = this.auditRevision ? "请调整第二张成片的冷暖对比，并减少背景高光。" : order ? order.revisionNote || "" : "";
    const onsite = order ? ["妆娘", "毛娘"].includes(order.career) : false;
    const acceptIssues = [];
    if (order && order.stage === "DELIVERY_PENDING") {
      if (!String(order.deliveryNote || "").trim()) acceptIssues.push(onsite ? "服务方尚未填写现场完成说明" : "服务方尚未填写交付说明");
      if (!onsite && !(order.deliveryFiles || []).length) acceptIssues.push("服务方尚未提交交付文件");
    }
    this.setData({
      order, onsite,
      validStage: order ? ["DELIVERY_PENDING", "COMPLETED"].includes(order.stage) : false,
      revision, canRevise: Boolean(revision.trim()),
      canAccept: Boolean(order && order.stage === "DELIVERY_PENDING" && acceptIssues.length === 0),
      acceptIssues,
      providerIdentity: order ? presentation.providerIdentity(order) : null,
      schedule: order ? presentation.scheduleFor(order) : { mode: "", lines: [] }
    });
  },

  updateRevision(event) {
    const revision = event.detail.value;
    this.setData({ revision, canRevise: Boolean(revision.trim()) });
  },

  revise() {
    const revisionNote = this.data.revision.trim();
    if (!revisionNote || !this.data.order || this.data.order.stage !== "DELIVERY_PENDING") return;
    if (this.cloudMode) return this.runTransition("BUYER_REQUESTS_REVISION", { detail: revisionNote });
    store.applyEvent(this.orderId, "BUYER_REQUESTS_REVISION", { revisionNote });
    this.load();
  },

  accept() {
    if (!this.data.canAccept) return wx.showToast({ title: this.data.acceptIssues[0] || "当前不能确认验收", icon: "none" });
    wx.showModal({
      title: this.data.onsite ? "确认现场服务完成" : "确认验收完成",
      content: `确认后将以￥${this.data.order.finalPrice}记录本订单完成，不能再申请修改。`,
      confirmColor: "#c6536b",
      success: ({ confirm }) => {
        if (!confirm) return;
        if (this.cloudMode) return this.runTransition("BUYER_ACCEPTS_DELIVERY");
        store.applyEvent(this.orderId, "BUYER_ACCEPTS_AND_SETTLES");
        this.load();
      }
    });
  },

  async runTransition(event, fields = {}) {
    if (this.data.actionPending || !this.data.order) return;
    this.setData({ actionPending: true, loadError: "" });
    try {
      const order = await cloudOrders.transitionOrder(this.orderId, this.data.order.version, event, fields);
      this.renderOrder(order);
      this.setData({ actionPending: false });
      wx.showToast({ title: event === "BUYER_REQUESTS_REVISION" ? "修改意见已同步" : "验收结果已同步" });
    } catch (error) {
      this.setData({ actionPending: false, loadError: this.cloudErrorMessage(error) });
      if (error && error.code === "VERSION_CONFLICT") this.load();
      else wx.showToast({ title: this.cloudErrorMessage(error), icon: "none" });
    }
  },

  async openDeliveryFile(event) {
    const index = Number(event.currentTarget.dataset.index);
    const file = this.data.order && this.data.order.deliveryFiles && this.data.order.deliveryFiles[index];
    if (!file || !file.fileId || this.data.actionPending) return;
    this.setData({ actionPending: true });
    try {
      const result = await wx.cloud.downloadFile({ fileID: file.fileId });
      if (String(file.mimeType || "").startsWith("image/")) wx.previewImage({ urls: [result.tempFilePath] });
      else await wx.openDocument({ filePath: result.tempFilePath, showMenu: true });
    } catch {
      wx.showToast({ title: "交付文件打开失败，请稍后重试", icon: "none" });
    } finally {
      this.setData({ actionPending: false });
    }
  },

  retryLoad() { this.load(); },
  cloudErrorMessage(error) {
    const messages = {
      ORDER_NOT_FOUND: "没有找到这笔订单。",
      VERSION_CONFLICT: "订单状态已变化，正在刷新。",
      ILLEGAL_TRANSITION: "当前状态不能执行该操作，请刷新后重试。",
      ORDER_ROLE_FORBIDDEN: "当前身份不能执行该操作。",
      DELIVERY_INCOMPLETE: "交付内容不完整，暂时不能确认验收。"
    };
    return messages[error && error.code] || "订单操作失败，请稍后重试。";
  },

  goOrders() { wx.switchTab({ url: "/pages/orders/index" }); },
  goReview() { wx.navigateTo({ url: `/pages/review/index?id=${this.orderId}` }); }
});
