const store = require("../../data/v063-store");
const paymentGateway = require("../../data/payment-gateway");
const presentation = require("../../data/order-presentation");
const { stageLabels } = require("../../data/v063");
const cloudOrders = require("../../services/cloud-orders");

const STEP_TITLES = ["预约沟通发起", "完成预约沟通", "合作确立确认", "执行制作"];

function confirmAction(title, content, onConfirm) {
  wx.showModal({ title, content, confirmColor: "#c6536b", success: ({ confirm }) => { if (confirm) onConfirm(); } });
}

function stepFor(order) {
  if (["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING", "COMPLETED"].includes(order.stage)) return 4;
  if (["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM"].includes(order.stage)) return 3;
  if (order.stage === "CONTACTING" && Number.isFinite(order.contactFirstCopiedAt)) return 2;
  return 1;
}

function buildJourney(currentStep) {
  return STEP_TITLES.map((title, index) => ({ number: index + 1, title, state: index + 1 < currentStep ? "done" : index + 1 === currentStep ? "active" : "upcoming" }));
}

function agreementIssues(order) {
  const issues = [];
  if (!order.communicationDone) issues.push("服务方尚未提交沟通结果");
  if (!order.timePlaceConfirmed) issues.push("时间地点尚未确认");
  if (!order.serviceScopeConfirmed) issues.push("服务内容尚未确认");
  if (order.ndaRequired === null || order.ndaRequired === undefined) issues.push("保密需求尚未确认");
  if (!order.amountConfirmed) issues.push("合作金额尚未确认");
  if (!order.executable) issues.push("服务方尚未确认可以履约");
  if (order.ndaRequired === true && (!order.buyerNdaSigned || !order.providerNdaSigned)) issues.push("保密协议尚未完成双方签署");
  return issues;
}

Page({
  data: {
    order: null, statusTitle: "", supplement: "", canSubmitSupplement: false,
    replyMinutes: null, replySampleCount: 0, currentStep: 1, journeySteps: [], journeyTitle: "", journeyLead: "",
    isSupplement: false, isFailed: false, showJourney: false, isStepOne: false, isStepTwo: false,
    isStepThree: false, isStepFour: false, agreementIssues: [], canSignNda: false,
    waitingProviderNda: false, canConfirmAgreement: false, agreementConfirmed: false,
    paymentStatus: "UNPAID", paying: false, paymentHint: "", totalPrice: 0,
    buyerIdentity: null, providerIdentity: null, schedule: { mode: "", lines: [] },
    loading: false, loadError: "", actionPending: false
  },

  onLoad(options) {
    this.orderId = options.id;
    this.auditStage = options.audit === "1" ? options.stage : "";
    this.auditPrefill = options.audit === "1" && options.prefill === "1";
    this.auditFailure = options.audit === "1" ? options.failure : "";
    this.auditStarted = options.audit === "1" && options.started === "1";
    this.auditAgreement = options.audit === "1" && options.agreement === "1";
    this.auditPaymentStatus = options.audit === "1" ? options.paymentStatus : "";
    this.auditSegments = options.audit === "1" && options.segments === "1";
    this.cloudMode = options.audit !== "1";
  },
  onShow() { this.loadOrder(); },
  onPullDownRefresh() { this.loadOrder(); if (wx.stopPullDownRefresh) wx.stopPullDownRefresh(); },
  auditScroll(scrollTop) { if (this.auditStage && wx.pageScrollTo) wx.pageScrollTo({ scrollTop, duration: 0 }); },

  async loadOrder() {
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
    let savedOrder = store.findOrder(this.orderId);
    if (!savedOrder) return this.setData({ order: null });
    if (!this.auditStage && savedOrder.stage === "BUYER_FINAL_CONFIRM" && savedOrder.paymentStatus === "PAID") {
      savedOrder = store.applyEvent(this.orderId, "PAYMENT_VERIFIED", { progress: 10, paidAt: savedOrder.paidAt || Date.now() });
    }
    this.renderOrder(savedOrder);
  },

  renderOrder(savedOrder) {
    const advancedStages = ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "IN_PRODUCTION"];
    const order = this.auditStage ? Object.assign({}, savedOrder, {
      stage: this.auditStage,
      contactFirstCopiedAt: this.auditStarted ? (Number.isFinite(savedOrder.requestedAt) ? savedOrder.requestedAt : Date.now() - 20 * 60000) + 20 * 60000 : savedOrder.contactFirstCopiedAt,
      communicationDone: advancedStages.includes(this.auditStage),
      timePlaceConfirmed: advancedStages.includes(this.auditStage), serviceScopeConfirmed: advancedStages.includes(this.auditStage),
      amountConfirmed: advancedStages.includes(this.auditStage), executable: advancedStages.includes(this.auditStage),
      ndaRequired: ["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(this.auditStage),
      buyerNdaSigned: this.auditStage !== "NDA_BUYER_PENDING",
      providerNdaSigned: !["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(this.auditStage),
      buyerAgreementConfirmedAt: this.auditAgreement ? Date.now() : savedOrder.buyerAgreementConfirmedAt,
      paymentStatus: this.auditPaymentStatus || savedOrder.paymentStatus,
      bookingDraft: this.auditSegments ? Object.assign({}, savedOrder.bookingDraft, { timeMode: "segments", segments: [
        { id: 1, startDate: "2026-08-25", startTime: "06:30", endDate: "2026-08-25", endTime: "09:00" },
        { id: 2, startDate: "2026-08-26", startTime: "13:30", endDate: "2026-08-27", endTime: "16:00" }
      ] }) : savedOrder.bookingDraft,
      declinePhase: this.auditStage === "DECLINED" ? this.auditFailure || "request" : savedOrder.declinePhase,
      supplementNote: this.auditStage === "DECLINED"
        ? this.auditFailure === "communication" ? "双方未能确认本次服务时间与执行范围。" : "当前档期与拍摄时间冲突，暂时无法承接。"
        : "请补充角色设定图与期望妆面风格。"
    }) : savedOrder;
    const replyMetric = order.cloudOrder ? { averageResponseMinutes: null, sampleCount: 0 } : store.getProviderReplyMetric(order.providerId);
    const currentStep = stepFor(order);
    const isSupplement = order.stage === "SUPPLEMENT_REQUESTED";
    const isFailed = order.stage === "DECLINED";
    const showJourney = !isSupplement && !isFailed;
    const issues = currentStep === 3 ? agreementIssues(order) : [];
    const agreementConfirmed = Boolean(order.buyerAgreementConfirmedAt);
    const totalPrice = (order.serviceItems || []).reduce((sum, item) => sum + Number(item.finalPrice || 0), 0) || Number(order.finalPrice || 0);
    const schedule = presentation.scheduleFor(order);
    let journeyLead = "现在无需重复操作，接下来由服务方评估是否愿意开始沟通。";
    if (currentStep === 1 && order.stage === "CONTACTING") journeyLead = "老师已接受预约，正在准备联系你；首次获取联系方式后将进入下一步。";
    if (currentStep === 2) journeyLead = `老师已获取你留下的联系方式，请留意微信或电话，并与 ${order.provider} 完成沟通。`;
    if (currentStep === 3) journeyLead = "服务方已提交合作条件，请逐项核对双方信息；确认并支付后才能开始制作。";
    if (currentStep === 4) journeyLead = "支付结果已经服务端确认，合作正式进入履约制作。";
    const supplement = this.auditPrefill ? "已补充冷调男性角色设定图。" : this.data.supplement;
    this.setData({
      order, statusTitle: stageLabels[order.stage] || "预约状态", supplement,
      canSubmitSupplement: Boolean(supplement.trim()), replyMinutes: replyMetric.averageResponseMinutes,
      replySampleCount: replyMetric.sampleCount, currentStep, journeySteps: buildJourney(currentStep),
      journeyTitle: STEP_TITLES[currentStep - 1], journeyLead, isSupplement, isFailed, showJourney,
      isStepOne: showJourney && currentStep === 1, isStepTwo: showJourney && currentStep === 2,
      isStepThree: showJourney && currentStep === 3, isStepFour: showJourney && currentStep === 4,
      agreementIssues: issues,
      canSignNda: order.stage === "NDA_BUYER_PENDING" && issues.length === 1 && issues[0] === "保密协议尚未完成双方签署",
      waitingProviderNda: order.stage === "NDA_PROVIDER_PENDING",
      canConfirmAgreement: order.stage === "BUYER_FINAL_CONFIRM" && issues.length === 0 && !agreementConfirmed,
      agreementConfirmed, paymentStatus: order.paymentStatus || "UNPAID", totalPrice,
      buyerIdentity: presentation.buyerIdentity(order), providerIdentity: presentation.providerIdentity(order), schedule,
      paymentHint: order.paymentStatus === "PAID" ? "付款已确认，等待订单进入履约"
        : order.paymentStatus === "PAYMENT_REVIEW" ? "已收到付款记录，金额或订单状态需要核对，请勿重复付款"
          : order.paymentStatus === "VERIFYING" ? "支付结果确认中，请稍后下拉刷新" : "确认合作信息后可继续付款"
    });
  },

  updateSupplement(event) { const supplement = event.detail.value; this.setData({ supplement, canSubmitSupplement: Boolean(supplement.trim()) }); },
  submitSupplement() {
    const value = this.data.supplement.trim();
    if (!value) return wx.showToast({ title: "请填写补充信息", icon: "none" });
    if (this.cloudMode) return this.runTransition("BUYER_SUPPLEMENTS", { detail: value }, () => {
      this.setData({ supplement: "", canSubmitSupplement: false });
    });
    store.applyEvent(this.orderId, "BUYER_SUPPLEMENTS", { requirement: `${this.data.order.requirement}\n补充：${value}` });
    this.auditStage = ""; this.setData({ supplement: "", canSubmitSupplement: false }); this.loadOrder();
  },
  signNda() {
    if (this.auditStage || !this.data.canSignNda) return;
    confirmAction("确认签署保密协议", "请确认已经阅读保密约定。当前原型只记录签署顺序，不生成法律电子签章。", () => {
      if (this.cloudMode) return this.runTransition("BUYER_SIGNS_NDA");
      store.applyEvent(this.orderId, "BUYER_SIGNS_NDA", { buyerNdaSigned: true }); this.loadOrder();
    });
  },
  confirmAgreement() {
    if (this.auditStage || !this.data.canConfirmAgreement) return;
    confirmAction("确认本次合作信息", `将按页面所列内容及合计 ￥${this.data.totalPrice} 进入支付。确认信息不会直接扣款。`, () => {
      if (this.cloudMode) return this.runTransition("BUYER_CONFIRMS_AGREEMENT");
      store.updateOrder(this.orderId, { buyerAgreementConfirmedAt: Date.now() }); this.loadOrder();
    });
  },
  startPayment() {
    if (this.auditStage || !this.data.agreementConfirmed || this.data.paying || ["PAID", "VERIFYING", "PAYMENT_REVIEW"].includes(this.data.paymentStatus)) return;
    if (this.cloudMode) return this.startCloudPayment();
    this.setData({ paying: true });
    paymentGateway.requestOrderPayment(this.data.order).then(() => {
      store.updateOrder(this.orderId, { paymentStatus: "VERIFYING" }); this.setData({ paying: false }); this.loadOrder();
      wx.showToast({ title: "支付结果确认中", icon: "none" });
    }).catch((error) => {
      this.setData({ paying: false });
      if (error.code === "PAYMENT_NOT_CONFIGURED") return wx.showModal({ title: "支付服务尚未接通", content: "当前订单还没有服务端生成的微信支付参数。接通商户号、下单接口和支付回调后才可付款。", showCancel: false, confirmColor: "#c6536b" });
      if (error.code === "PAYMENT_CANCELLED") return wx.showToast({ title: "已取消支付，可稍后重试", icon: "none" });
      store.updateOrder(this.orderId, { paymentStatus: "FAILED" }); this.loadOrder();
      wx.showToast({ title: "支付未完成，请重试", icon: "none" });
    });
  },
  async startCloudPayment() {
    this.setData({ paying: true });
    let cashierReturned = false;
    try {
      const order = await cloudOrders.getOrder(this.orderId);
      this.renderOrder(order);
      if (order.viewerRole !== "BUYER" || order.stage !== "BUYER_FINAL_CONFIRM"
        || !order.buyerAgreementConfirmedAt || agreementIssues(order).length
        || !["UNPAID", "FAILED"].includes(order.paymentStatus)) return;
      let paymentError;
      try {
        await paymentGateway.requestOrderPayment(order);
      } catch (error) {
        if (error && error.code === "PAYMENT_NOT_CONFIGURED") {
          wx.showModal({ title: "支付服务尚未接通", content: "暂时无法付款，合作信息已保留。支付服务开通后可继续。", showCancel: false });
          return;
        }
        paymentError = error;
      }
      cashierReturned = true;
      const latest = await cloudOrders.getOrder(this.orderId);
      this.renderOrder(latest);
      if (!["PAID", "VERIFYING", "PAYMENT_REVIEW"].includes(latest.paymentStatus)) {
        this.setData({ paymentHint: paymentError && paymentError.code === "PAYMENT_CANCELLED"
          ? "已退出收银台；尚未确认付款，可下拉刷新核对"
          : "尚未确认付款结果，请稍后下拉刷新核对" });
      }
    } catch (error) {
      this.setData({ paymentHint: cashierReturned
        ? "暂时无法核对付款结果，请下拉刷新；不要重复付款"
        : "暂时无法读取最新订单，请下拉刷新后重试" });
    } finally {
      this.setData({ paying: false });
    }
  },
  retryBooking() { wx.navigateTo({ url: `/pages/booking/index?providerId=${this.data.order.providerId}&repeatOrderId=${this.orderId}` }); },
  retryLoad() { this.loadOrder(); },
  async runTransition(event, fields = {}, after) {
    if (this.data.actionPending || !this.data.order) return;
    this.setData({ actionPending: true });
    try {
      const order = await cloudOrders.transitionOrder(this.orderId, this.data.order.version, event, fields);
      if (after) after(order);
      this.renderOrder(order);
      this.setData({ actionPending: false, loadError: "" });
    } catch (error) {
      this.setData({ actionPending: false, loadError: this.cloudErrorMessage(error) });
      if (error && error.code === "VERSION_CONFLICT") this.loadOrder();
      else wx.showToast({ title: this.cloudErrorMessage(error), icon: "none" });
    }
  },
  cloudErrorMessage(error) {
    const messages = {
      ORDER_NOT_FOUND: "没有找到这笔预约，可能已被移除。",
      VERSION_CONFLICT: "订单状态已变化，正在刷新。",
      ILLEGAL_TRANSITION: "当前状态不能执行该操作，请刷新后重试。",
      ORDER_ROLE_FORBIDDEN: "当前身份不能执行该操作。",
      PAYMENT_NOT_VERIFIED: "支付尚未由服务端确认，不能进入制作。",
      AGREEMENT_NOT_CONFIRMED: "请先确认本次合作信息，再进入制作。"
    };
    return messages[error && error.code] || "订单请求失败，请稍后重试。";
  },
  goMarket() { wx.switchTab({ url: "/pages/discover/index" }); },
  goOrder() { wx.navigateTo({ url: `/pages/order-detail/index?id=${this.orderId}` }); }
});

module.exports = { stepFor, buildJourney, agreementIssues };
