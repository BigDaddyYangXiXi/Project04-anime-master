const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const { stageLabels } = require("../../data/v063");
const { transitionOrder } = require("../../data/order-machine");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");
const previewSlots = require("../../data/preview-order-slots");
const { sanitizeYuanInput } = require("../../utils/input-normalization");

const confirmAction = require("../../utils/order-confirmation");

function normalizeQuoteItems(order) {
  const items = Array.isArray(order.serviceItems) && order.serviceItems.length
    ? order.serviceItems
    : [{ id: "legacy", name: order.service, displayPrice: order.originalPrice || order.finalPrice, finalPrice: order.finalPrice }];
  return items.map((item, index) => {
    const displayPrice = Number(item.displayPrice) || 0;
    const finalPrice = Number(item.finalPrice) || displayPrice;
    return {
      id: item.id || `service-${index}`, name: item.name || `服务项目 ${index + 1}`,
      displayPrice, finalPrice, originalFinalPrice: finalPrice,
      minPrice: Math.ceil(displayPrice * 85 / 100), maxPrice: Math.floor(displayPrice * 115 / 100)
    };
  });
}

Page({
  goRefund() {
    const order = this.data.order;
    if (order?.cloudOrder && order.viewerRole === 'PROVIDER' && order.paymentStatus === 'PAID') wx.navigateTo({url:`/pages/order-refund/index?id=${encodeURIComponent(this.orderId)}`});
  },
  openReference: require("../../utils/order-reference-preview"),
  data: {
    theme: require("../../data/design-theme"),
    order: null, statusLabel: "", ratingStars: "", note: "", price: 0, quoteItems: [], priceError: "",
    timePlaceConfirmed: false, serviceScopeConfirmed: false, ndaChoice: "", amountConfirmed: false,
    readyConfirm: false, confirmedCount: 0, amountHint: "", quoteChanged: false, priceCanSave: false, communicationIssues: [],
    delivery: "", deliveryFiles: [], progress: 0, progressChanged: false,
    onsite: false, deliveryReady: false, deliveryIssues: [], isRequest: false, isContacting: false,
    isNda: false, isWaitingBuyerConfirm: false, isProduction: false, isPending: false, isTerminal: false,
    buyerIdentity: null, providerIdentity: null, schedule: { mode: "", lines: [] },
    loading: false, loadError: "", actionPending: false
  },

  onLoad(options) {
    this.orderId = options.id;
    this.auditReady = localPreview.isAudit(options) && options.ready === "1";
    this.auditStage = localPreview.isAudit(options) ? options.stage : "";
    this.auditDelivery = localPreview.isAudit(options) && options.delivery === "1";
    this.auditQuote = localPreview.isAudit(options) ? options.quote : "";
    this.auditSegments = localPreview.isAudit(options) && options.segments === "1";
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
        this.renderOrder(order, { preserveDeliveryDraft: true });
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
    this.renderOrder(order, { preserveDeliveryDraft: true });
  },

  renderOrder(sourceOrder, { preserveDeliveryDraft = false } = {}) {
    if (sourceOrder.cloudOrder && this.data.order && this.data.order.id === sourceOrder.id
      && Number(this.data.order.version) > Number(sourceOrder.version)) return false;
    let order = presentation.providerOrderView(sourceOrder);
    if (this.auditStage) order = Object.assign({}, order, { stage: this.auditStage });
    if (this.auditSegments) order = Object.assign({}, order, { bookingDraft: Object.assign({}, order.bookingDraft, { timeMode: "segments", segments: [
      { id: 1, startDate: "2026-08-25", startTime: "06:30", endDate: "2026-08-25", endTime: "09:00" },
      { id: 2, startDate: "2026-08-26", startTime: "13:30", endDate: "2026-08-27", endTime: "16:00" }
    ] }) });
    const onsite = ["妆娘", "毛娘"].includes(order.career);
    const timePlaceConfirmed = this.auditReady ? true : Boolean(order.timePlaceConfirmed);
    const serviceScopeConfirmed = this.auditReady ? true : Boolean(order.serviceScopeConfirmed);
    const ndaChoice = this.auditReady ? "no" : order.ndaRequired === null ? "" : order.ndaRequired ? "yes" : "no";
    const amountConfirmed = this.auditReady ? true : Boolean(order.amountConfirmed);
    const previous = this.data.order;
    const sameDraft = preserveDeliveryDraft && previous && previous.id === order.id
      && previous.version === order.version && previous.stage === order.stage;
    const keepContact = sameDraft && order.stage === "CONTACTING";
    const keepDelivery = sameDraft && ["IN_PRODUCTION", "REVISION_REQUESTED"].includes(order.stage);
    const delivery = keepDelivery ? this.data.delivery : this.auditDelivery ? "已按需求方反馈完成本轮调整，请核对交付内容。" : order.deliveryNote || "";
    const deliveryFiles = keepDelivery ? this.data.deliveryFiles : this.auditDelivery && !onsite ? [{ name: "修订交付预览.jpg", type: "image/jpeg", path: "" }] : order.deliveryFiles || [];
    const quoteItems = keepContact ? this.data.quoteItems : normalizeQuoteItems(order);
    if (quoteItems[0] && this.auditQuote === "invalid") quoteItems[0].finalPrice = quoteItems[0].maxPrice + 1;
    if (quoteItems[0] && this.auditQuote === "valid") quoteItems[0].finalPrice = Math.min(quoteItems[0].maxPrice, quoteItems[0].originalFinalPrice + 20);
    this.setData({
      order, statusLabel: stageLabels[order.stage], ratingStars: "★".repeat(order.rating || 0), onsite,
      note: sameDraft && ["REQUESTED", "SUPPLEMENTED"].includes(order.stage) ? this.data.note : "",
      buyerIdentity: presentation.buyerIdentity(order), providerIdentity: presentation.providerIdentity(order), schedule: presentation.scheduleFor(order),
      price: quoteItems.reduce((sum, item) => sum + item.finalPrice, 0), quoteItems, priceError: "",
      timePlaceConfirmed: keepContact ? this.data.timePlaceConfirmed : timePlaceConfirmed,
      serviceScopeConfirmed: keepContact ? this.data.serviceScopeConfirmed : serviceScopeConfirmed,
      ndaChoice: keepContact ? this.data.ndaChoice : ndaChoice,
      amountConfirmed: keepContact ? this.data.amountConfirmed : amountConfirmed,
      delivery, deliveryFiles, progress: keepDelivery ? this.data.progress : order.progress || 0,
      isRequest: ["REQUESTED", "SUPPLEMENTED"].includes(order.stage),
      isContacting: order.stage === "CONTACTING",
      isNda: ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(order.stage),
      isWaitingBuyerConfirm: order.stage === "BUYER_FINAL_CONFIRM",
      isProduction: ["IN_PRODUCTION", "REVISION_REQUESTED"].includes(order.stage),
      isPending: order.stage === "DELIVERY_PENDING",
      isTerminal: ["COMPLETED", "DECLINED"].includes(order.stage)
    }, () => this.refreshDerived());
  },

  refreshDerived() {
    const order = this.data.order;
    if (!order) return;
    const invalidItem = this.data.quoteItems.find((item) => item.finalPrice < item.minPrice || item.finalPrice > item.maxPrice);
    const quoteChanged = this.data.quoteItems.some((item) => item.finalPrice !== item.originalFinalPrice);
    const communicationIssues = [];
    if (order.cloudOrder && !order.contactFirstCopiedAt) communicationIssues.push("先复制微信号或手机号，确认已经开始沟通");
    if (!this.data.timePlaceConfirmed) communicationIssues.push("1. 确认时间和地点");
    if (!this.data.serviceScopeConfirmed) communicationIssues.push("2. 确认服务内容");
    if (!this.data.ndaChoice) communicationIssues.push("3. 确认保密需求");
    if (!this.data.amountConfirmed) communicationIssues.push("4. 确认合作金额");
    const deliveryIssues = [];
    if (!this.data.delivery.trim()) deliveryIssues.push("填写本次交付说明");
    if (!this.data.onsite && !this.data.deliveryFiles.length) deliveryIssues.push("选择至少一个交付文件");
    this.setData({
      readyConfirm: communicationIssues.length === 0,
      confirmedCount: [this.data.timePlaceConfirmed, this.data.serviceScopeConfirmed, this.data.ndaChoice, this.data.amountConfirmed].filter(Boolean).length,
      amountHint: invalidItem
        ? "报价超出允许范围，请先修正"
        : quoteChanged
          ? "新报价尚未锁定，请先确认逐项报价"
          : order.priceEdited
            ? "报价已锁定，请核对后确认金额"
            : "沿用当前报价，核对后可直接确认",
      quoteChanged,
      communicationIssues,
      priceCanSave: !order.priceEdited && !invalidItem && quoteChanged,
      priceError: invalidItem ? `${invalidItem.name}的报价须在 ￥${invalidItem.minPrice}—￥${invalidItem.maxPrice} 之间。` : "",
      progressChanged: this.data.progress !== order.progress,
      deliveryReady: deliveryIssues.length === 0,
      deliveryIssues
    });
  },

  updateNote(event) { this.setData({ note: event.detail.value }); },
  updateQuoteItem(event) {
    if (this.data.order.priceEdited) return;
    const index = Number(event.currentTarget.dataset.index);
    const finalPrice = Number(sanitizeYuanInput(event.detail.value)) || 0;
    const quoteItems = this.data.quoteItems.map((item, itemIndex) => itemIndex === index ? Object.assign({}, item, { finalPrice }) : item);
    this.setData({ quoteItems, price: quoteItems.reduce((sum, item) => sum + item.finalPrice, 0), amountConfirmed: false }, () => this.refreshDerived());
  },
  updateDelivery(event) { if (this.data.actionPending) return; this.setData({ delivery: event.detail.value }, () => this.refreshDerived()); },
  commitProgress(event) { this.setData({ progress: Number(event.detail.value) }, () => this.refreshDerived()); },
  toggleConfirm(event) {
    const key = event.currentTarget.dataset.key;
    const quoteChanged = this.data.quoteItems.some((item) => item.finalPrice !== item.originalFinalPrice);
    if (key === "amountConfirmed" && quoteChanged) return wx.showToast({ title: "请先确认逐项报价", icon: "none" });
    this.setData({ [key]: !this.data[key] }, () => this.refreshDerived());
  },
  chooseNda(event) {
    if (this.data.order.ndaFlowVersion === 2) return;
    this.setData({ ndaChoice: event.currentTarget.dataset.value }, () => this.refreshDerived());
  },

  interested() {
    if (this.cloudMode) return this.runTransition("PROVIDER_INTERESTED");
    store.applyEvent(this.orderId, "PROVIDER_INTERESTED"); this.load();
  },
  supplement() {
    if (!this.data.note.trim()) return wx.showToast({ title: "请先填写需要补充的内容", icon: "none" });
    if (this.cloudMode) return this.runTransition("PROVIDER_REQUESTS_SUPPLEMENT", { detail: this.data.note.trim() }, () => this.setData({ note: "" }));
    store.applyEvent(this.orderId, "PROVIDER_REQUESTS_SUPPLEMENT", { supplementNote: this.data.note.trim() }); this.load();
  },
  decline() {
    const reason = this.data.note.trim() || "当前档期无法承接";
    confirmAction(this, "确认拒绝本次预约", `拒绝后订单将结束，需求方会看到原因：“${reason}”。`, () => {
      if (this.cloudMode) return this.runTransition("PROVIDER_DECLINES", { detail: reason });
      const order = store.findOrder(this.orderId);
      if (!order || !["REQUESTED", "SUPPLEMENTED"].includes(order.stage)) return this.load();
      store.applyEvent(this.orderId, "PROVIDER_DECLINES", { supplementNote: reason, declinePhase: "request" });
      this.load();
    });
  },

  copyContact(event) {
    const data = event.currentTarget.dataset.value;
    if (data) wx.setClipboardData({ data, success: () => {
      if (this.cloudMode) {
        if (!this.data.order.contactFirstCopiedAt) this.runTransition("PROVIDER_RECORDS_CONTACT");
      } else store.recordContactCopy(this.orderId);
    } });
  },
  callBuyer() {
    if (this.data.order.contact.phone) wx.makePhoneCall({ phoneNumber: this.data.order.contact.phone });
  },
  savePrice() {
    if (!this.data.priceCanSave) return;
    const serviceItems = this.data.quoteItems.map(({ id, name, displayPrice, finalPrice }) => ({ id, name, displayPrice, finalPrice }));
    confirmAction(this, "确认锁定本次报价", `合计 ￥${this.data.price}。确认后本次报价不能再次修改。`, () => {
      if (this.cloudMode) {
        const confirmations = {
          timePlaceConfirmed: this.data.timePlaceConfirmed,
          serviceScopeConfirmed: this.data.serviceScopeConfirmed,
          ndaChoice: this.data.ndaChoice,
          amountConfirmed: false
        };
        return this.runTransition("PROVIDER_LOCKS_QUOTE", {
          items: serviceItems.map((item) => ({ serviceId: item.id, finalPriceFen: Math.round(item.finalPrice * 100) }))
        }, () => this.setData(confirmations, () => this.refreshDerived()));
      }
      const order = store.findOrder(this.orderId);
      if (!order || order.stage !== "CONTACTING" || order.priceEdited) return this.load();
      store.updateOrder(this.orderId, { serviceItems, finalPrice: this.data.price, priceEdited: true });
      const updatedOrder = store.findOrder(this.orderId);
      const quoteItems = normalizeQuoteItems(updatedOrder);
      this.setData({
        order: updatedOrder,
        quoteItems,
        price: updatedOrder.finalPrice,
        priceError: ""
      }, () => this.refreshDerived());
    });
  },
  finishCommunication() {
    if (!this.data.readyConfirm) return wx.showToast({ title: "请完成四项合作确认", icon: "none" });
    const ndaRequired = this.data.ndaChoice === "yes";
    confirmAction(this, "确认结束沟通", `${ndaRequired ? "需要先完成 NDA 签署" : "无需 NDA"}；合作金额 ￥${this.data.price}。确认成功后占用本次合作时段，并进入需求方确认。`, () => {
      if (this.cloudMode) return this.runTransition("PROVIDER_ENDS_COMMUNICATION", {
        ndaRequired,
        timePlaceConfirmed: this.data.timePlaceConfirmed,
        serviceScopeConfirmed: this.data.serviceScopeConfirmed,
        amountConfirmed: this.data.amountConfirmed
      });
      const order = store.findOrder(this.orderId);
      if (!order || order.stage !== "CONTACTING") return this.load();
      if (previewSlots.hasConflict(order, store.getOrders())) return wx.showToast({ title: this.cloudErrorMessage({ code: "SCHEDULE_CONFLICT" }), icon: "none" });
      store.updateOrder(this.orderId, {
        communicationDone: true, timePlaceConfirmed: true, serviceScopeConfirmed: true,
        ndaRequired, amountConfirmed: true, executable: true,
        stage: transitionOrder(order.stage, "PROVIDER_ENDS_COMMUNICATION", ndaRequired, order)
      });
      this.load();
    });
  },
  failCommunication() {
    const reason = this.data.note.trim() || "本次沟通未能确认合作条件";
    confirmAction(this, "确认合作不确立", `提交后本次预约将结束，需求方可使用原信息再次发起。对方会看到原因：“${reason}”。`, () => {
      if (this.cloudMode) return this.runTransition("PROVIDER_ENDS_COMMUNICATION_FAILED", { detail: reason });
      const order = store.findOrder(this.orderId);
      if (!order || order.stage !== "CONTACTING") return this.load();
      store.applyEvent(this.orderId, "PROVIDER_ENDS_COMMUNICATION_FAILED", { supplementNote: reason, declinePhase: "communication" });
      this.load();
    });
  },
  goNda() { wx.navigateTo({ url: `/pages/provider-task/index?id=${this.orderId}` }); },

  retryLoad() { this.load(); },
  async runTransition(event, fields = {}, after) {
    if (this.unloaded || this.data.actionPending || !this.data.order) return;
    this.setData({ actionPending: true });
    try {
      const order = await cloudOrders.transitionOrder(this.orderId, this.data.order.version, event, fields);
      if (this.unloaded) return;
      this.renderOrder(order);
      if (after) after(order);
      this.setData({ actionPending: false, loadError: "" });
    } catch (error) {
      if (this.unloaded) return;
      this.setData({ actionPending: false, loadError: this.cloudErrorMessage(error) });
      if (error && error.code === "VERSION_CONFLICT") this.load();
      else wx.showToast({ title: this.cloudErrorMessage(error), icon: "none" });
    }
  },
  cloudErrorMessage(error) {
    const messages = {
      ORDER_NOT_FOUND: "没有找到这笔订单。",
      VERSION_CONFLICT: "订单状态已变化，正在刷新。",
      SCHEDULE_CONFLICT: "该时段已有已确认的合作，请与需求方调整时间后重新预约。",
      SLOT_STORE_NOT_CONFIGURED: "档期确认服务暂不可用，请稍后重试。",
      NDA_REQUIRED: "请先完成双方保密协议签署，不能取消需求方的保密要求。",
      PROVIDER_NOT_QUALIFIED: "接单规则尚未同步，请稍后重试；无需申请入驻审核。",
      ILLEGAL_TRANSITION: "当前状态不能执行该操作，请刷新后重试。",
      ORDER_ROLE_FORBIDDEN: "当前身份不能执行该操作。",
      QUOTE_OUT_OF_RANGE: "报价超出允许范围，请修正后重试。",
      QUOTE_ALREADY_LOCKED: "报价已经锁定，正在刷新最新订单。",
      CONTACT_NOT_ACCESSED: "请先获取需求方联系方式，再提交沟通结果。",
      COOPERATION_CONFIRMATION_REQUIRED: "请逐项确认时间地点、服务内容和合作金额。",
      PROGRESS_INVALID: "执行进度只能填写 0—99；提交交付后自动变为 100%。",
      PROGRESS_UNCHANGED: "执行进度没有变化。",
      DELIVERY_FILES_REQUIRED: "请选择 1—5 个交付文件。",
      DELIVERY_FILE_TYPE_UNSUPPORTED: "交付文件仅支持图片、PDF、ZIP 或 TXT。",
      DELIVERY_FILE_SIZE_INVALID: "单个交付文件须小于 20 MB。",
      DELIVERY_FILE_INVALID: "交付文件未通过服务端校验，请重新选择。",
      DELIVERY_ROUND_LIMIT: "本订单交付轮次已达上限，请联系平台处理。"
    };
    return messages[error && error.code] || "订单操作失败，请稍后重试。";
  },

  saveProgress() {
    if (!this.data.progressChanged) return;
    if (this.cloudMode) return this.runTransition("PROVIDER_UPDATES_PROGRESS", { progress: this.data.progress }, () => {
      wx.showToast({ title: "执行进度已同步" });
    });
    store.updateOrder(this.orderId, { progress: this.data.progress }); this.load();
    wx.showToast({ title: "执行进度已同步" });
  },
  chooseDeliveryFiles() {
    if (this.unloaded || this.data.actionPending) return;
    wx.chooseMessageFile({ count: 5, type: "all", success: ({ tempFiles }) => {
      if (this.unloaded || this.data.actionPending || !tempFiles || !tempFiles.length) return;
      this.setData({ deliveryFiles: tempFiles.map((file) => ({ name: file.name, type: file.type || "file", path: file.path, size: file.size })) }, () => this.refreshDerived());
    }, fail: (error) => {
      if (this.unloaded) return;
      if (!/cancel/i.test(String(error && error.errMsg || ""))) wx.showToast({ title: "无法选择交付文件，请重试", icon: "none" });
    } });
  },
  submitDelivery() {
    if (this.unloaded || this.data.actionPending) return;
    if (!this.data.deliveryReady) return wx.showToast({ title: this.data.deliveryIssues[0] || "请完成交付信息", icon: "none" });
    const action = this.data.order.stage === "REVISION_REQUESTED" ? "重新提交后" : "提交后";
    confirmAction(this, "确认提交本次交付", `${action}将等待需求方验收；交付说明和文件会同步给需求方。`, () => {
      if (this.unloaded) return;
      if (this.cloudMode) return this.submitCloudDelivery();
      const order = store.findOrder(this.orderId);
      if (!order || !["IN_PRODUCTION", "REVISION_REQUESTED"].includes(order.stage)) return this.load();
      store.updateOrder(this.orderId, {
        deliveryNote: this.data.delivery.trim(), deliveryFiles: this.data.deliveryFiles,
        progress: 100, stage: transitionOrder(order.stage, "PROVIDER_SUBMITS_DELIVERY")
      });
      this.load();
    });
  },

  async submitCloudDelivery() {
    if (this.unloaded || this.data.actionPending || !this.data.order) return;
    const orderId = this.orderId;
    const expectedVersion = this.data.order.version;
    const deliveryNote = this.data.delivery.trim();
    const selectedFiles = this.data.deliveryFiles;
    const onsite = this.data.onsite;
    this.setData({ actionPending: true, loadError: "" });
    let uploaded = [];
    try {
      if (!onsite) {
        uploaded = await cloudOrders.uploadDeliveryFiles(orderId, selectedFiles);
        if (this.unloaded) return;
        if (this.orderId === orderId && this.data.deliveryFiles === selectedFiles) this.setData({ deliveryFiles: uploaded });
      }
      const order = await cloudOrders.transitionOrder(orderId, expectedVersion, "PROVIDER_SUBMITS_DELIVERY", {
        deliveryNote,
        deliveryFiles: uploaded
      });
      if (this.unloaded) return;
      this.renderOrder(order);
      this.setData({ actionPending: false });
      wx.showToast({ title: "交付已提交" });
    } catch (error) {
      if (this.unloaded) return;
      this.setData({ actionPending: false, loadError: this.cloudErrorMessage(error) });
      if (error && error.code === "VERSION_CONFLICT") this.load();
      else wx.showToast({ title: this.cloudErrorMessage(error), icon: "none" });
    }
  }
});
