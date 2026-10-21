const { nativeBrandColor } = require("../../data/design-theme");
const localPreview = require("../../utils/local-preview");
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
    this.unloaded = false;
    this.orderId = options.id;
    this.auditRevision = localPreview.isAudit(options) && options.revision === "1";
    this.cloudMode = !localPreview.isAudit(options);
  },

  onShow() { this.load(); },
  onUnload() { this.unloaded = true; this.loadRequest = (this.loadRequest || 0) + 1; },

  async load() {
    if (this.cloudMode) {
      const request = this.loadRequest = (this.loadRequest || 0) + 1;
      const visibleOrder = this.data.order;
      this.setData({ loading: true, loadError: "" });
      try {
        const order = await cloudOrders.getOrder(this.orderId);
        if (request !== this.loadRequest) return;
        this.renderOrder(order, { preserveRevision: true });
      } catch (error) {
        if (request === this.loadRequest && this.data.order === visibleOrder) this.setData({ order: null, loadError: this.cloudErrorMessage(error) });
      } finally {
        if (request === this.loadRequest) this.setData({ loading: false });
      }
      return;
    }
    this.renderOrder(store.findOrder(this.orderId));
  },

  renderOrder(order, { preserveRevision = false } = {}) {
    if (order && order.cloudOrder && this.data.order && this.data.order.id === order.id
      && Number(this.data.order.version) > Number(order.version)) return false;
    const previous = this.data.order;
    const keepRevision = preserveRevision && order && previous && previous.id === order.id
      && previous.version === order.version && previous.stage === order.stage && order.stage === "DELIVERY_PENDING";
    const revision = keepRevision ? this.data.revision
      : this.auditRevision ? "请调整第二张成片的冷暖对比，并减少背景高光。" : order ? order.revisionNote || "" : "";
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
    if (this.data.actionPending || this.acceptPromptOpen || this.unloaded) return;
    if (!this.data.canAccept) return wx.showToast({ title: this.data.acceptIssues[0] || "当前不能确认验收", icon: "none" });
    const confirmedOrder = this.data.order;
    const confirmedVersion = confirmedOrder.version;
    this.acceptPromptOpen = true;
    wx.showModal({
      title: this.data.onsite ? "确认现场服务完成" : "确认验收完成",
      content: `请确认服务与交付符合约定。确认后将以￥${this.data.order.finalPrice}记录交易完成，关闭修改及普通退款申请；特殊争议仍可反馈并依法处理。`,
      confirmColor: nativeBrandColor,
      success: ({ confirm }) => {
        if (!confirm || this.unloaded) return;
        const current = this.data.order;
        if (!current || current.id !== confirmedOrder.id || current.version !== confirmedVersion
          || current.stage !== "DELIVERY_PENDING" || !this.data.canAccept) {
          wx.showToast({ title: "交付内容已更新，请重新核对后验收", icon: "none" });
          return;
        }
        if (this.cloudMode) return this.runTransition("BUYER_ACCEPTS_DELIVERY");
        store.applyEvent(this.orderId, "BUYER_ACCEPTS_AND_SETTLES");
        this.load();
      },
      complete: () => { this.acceptPromptOpen = false; }
    });
  },

  async runTransition(event, fields = {}) {
    if (this.unloaded || this.data.actionPending || !this.data.order) return;
    this.setData({ actionPending: true, loadError: "" });
    try {
      const order = await cloudOrders.transitionOrder(this.orderId, this.data.order.version, event, fields);
      if (this.unloaded) return;
      this.renderOrder(order);
      this.setData({ actionPending: false });
      wx.showToast({ title: event === "BUYER_REQUESTS_REVISION" ? "修改意见已同步" : "验收结果已同步" });
    } catch (error) {
      if (this.unloaded) return;
      this.setData({ actionPending: false, loadError: this.cloudErrorMessage(error) });
      if (error && error.code === "VERSION_CONFLICT") this.load();
      else wx.showToast({ title: this.cloudErrorMessage(error), icon: "none" });
    }
  },

  async openDeliveryFile(event) {
    const index = Number(event.currentTarget.dataset.index);
    const file = this.data.order && this.data.order.deliveryFiles && this.data.order.deliveryFiles[index];
    if (!file || !file.fileId || this.data.actionPending || this.unloaded) return;
    this.setData({ actionPending: true });
    try {
      const access = await cloudOrders.getDeliveryDownload(this.orderId, file.assetId);
      if (this.unloaded) return;
      const forwardFile = ["application/zip", "application/x-zip-compressed", "text/plain"].includes(access.mimeType);
      if (forwardFile) {
        if (typeof wx.shareFileMessage !== "function") {
          wx.showToast({ title: "请升级微信后转发此文件", icon: "none" });
          return;
        }
        const choice = await new Promise((resolve, reject) => wx.showModal({
          title: "转发交付文件",
          content: "此格式无法在小程序内预览。可转发到你选择的聊天后查看，请遵守本订单的保密约定。",
          confirmText: "选择聊天", success: resolve, fail: reject
        }));
        if (!choice.confirm || this.unloaded) return;
      }
      const result = await new Promise((resolve, reject) => wx.downloadFile({ url: access.url, success: resolve, fail: reject }));
      if (this.unloaded) return;
      if (result.statusCode !== 200 || !result.tempFilePath) throw new Error("DOWNLOAD_FAILED");
      if (String(access.mimeType || "").startsWith("image/")) await new Promise((resolve, reject) => wx.previewImage({ urls: [result.tempFilePath], success: resolve, fail: reject }));
      else if (access.mimeType === "application/pdf") await new Promise((resolve, reject) => wx.openDocument({ filePath: result.tempFilePath, fileType: "pdf", showMenu: true, success: resolve, fail: reject }));
      else if (forwardFile) await new Promise((resolve, reject) => wx.shareFileMessage({ filePath: result.tempFilePath, fileName: access.name, success: resolve, fail: reject }));
      else throw new Error("UNSUPPORTED_FILE_TYPE");
    } catch (error) {
      if (!this.unloaded && !/cancel/i.test(String(error && error.errMsg || ""))) wx.showToast({ title: "交付文件打开失败，请稍后重试", icon: "none" });
    } finally {
      if (!this.unloaded) this.setData({ actionPending: false });
    }
  },

  retryLoad() { this.load(); },
  cloudErrorMessage(error) {
    const messages = {
      ORDER_NOT_FOUND: "没有找到这笔订单。",
      VERSION_CONFLICT: "订单状态已变化，正在刷新。",
      ILLEGAL_TRANSITION: "当前状态不能执行该操作，请刷新后重试。",
      ORDER_ROLE_FORBIDDEN: "当前身份不能执行该操作。",
      DELIVERY_INCOMPLETE: "交付内容不完整，暂时不能确认验收。",
      ORDER_FUNDS_HELD: "退款或争议尚未处理完毕，暂时不能确认验收。"
    };
    return messages[error && error.code] || "订单操作失败，请稍后重试。";
  },

  goOrders() { wx.switchTab({ url: "/pages/orders/index" }); },
  goReview() { wx.navigateTo({ url: `/pages/review/index?id=${this.orderId}` }); }
});
