const store = require("../../data/v063-store");
const presentation = require("../../data/order-presentation");
const cloudOrders = require("../../services/cloud-orders");

Page({
  data: {
    order: null, providerIdentity: null, rating: 0, text: "", textCount: 0,
    stars: [1, 2, 3, 4, 5], canReview: false, loading: false, loadError: "", actionPending: false
  },

  onLoad(options) {
    this.orderId = options.id;
    this.auditFresh = options.audit === "1" && options.fresh === "1";
    this.auditReply = options.audit === "1" && options.reply === "1";
    this.auditDraft = options.audit === "1" && options.draft === "1";
    this.cloudMode = options.audit !== "1";
    this.load();
  },

  async load() {
    if (this.cloudMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        this.renderOrder(await cloudOrders.getOrder(this.orderId));
        this.setData({ loading: false });
      } catch (error) {
        this.setData({ order: null, loading: false, loadError: this.cloudErrorMessage(error) });
      }
      return;
    }
    this.renderOrder(store.findOrder(this.orderId));
  },

  renderOrder(savedOrder) {
    if (!savedOrder) return this.setData({ order: null });
    const order = Object.assign({}, savedOrder,
      this.auditFresh ? { rating: 0, reviewText: "", reviewReply: "" } : {},
      this.auditReply ? { reviewReply: "很高兴这次妆面满足近景拍摄要求，感谢认真反馈。" } : {});
    const rating = this.auditDraft ? 4 : 0;
    const text = this.auditDraft ? "沟通清楚，现场妆面在近景镜头里很干净。" : "";
    this.setData({
      order: Object.assign({}, order, {
        initial: order.provider.slice(0, 1),
        ratingText: "★".repeat(order.rating || 0) + "☆".repeat(5 - (order.rating || 0))
      }),
      providerIdentity: presentation.providerIdentity(order), rating, text, textCount: text.length,
      canReview: order.stage === "COMPLETED"
    });
  },

  chooseRating(event) {
    if (this.data.order.rating) return;
    this.setData({ rating: Number(event.currentTarget.dataset.value) });
  },

  updateText(event) {
    const text = event.detail.value;
    this.setData({ text, textCount: text.length });
  },

  submit() {
    if (!this.data.order || this.data.order.stage !== "COMPLETED" || this.data.order.rating || !this.data.rating) return;
    wx.showModal({
      title: `确认提交 ${this.data.rating} 星评价`,
      content: "评分和评价内容提交后不可修改；服务方可以公开回复。",
      confirmColor: "#ff6f71",
      success: ({ confirm }) => {
        if (!confirm) return;
        if (this.cloudMode) return this.submitCloudReview();
        const order = store.findOrder(this.orderId);
        if (!order || order.stage !== "COMPLETED" || (order.rating && !this.auditFresh)) return this.load();
        store.updateOrder(this.orderId, { rating: this.data.rating, reviewText: this.data.text.trim() });
        this.auditFresh = false;
        this.auditDraft = false;
        this.load();
      }
    });
  },

  async submitCloudReview() {
    if (this.data.actionPending || !this.data.order) return;
    this.setData({ actionPending: true, loadError: "" });
    try {
      const order = await cloudOrders.transitionOrder(this.orderId, this.data.order.version, "BUYER_SUBMITS_REVIEW", {
        rating: this.data.rating, reviewText: this.data.text.trim()
      });
      this.renderOrder(order);
      this.setData({ actionPending: false, rating: 0, text: "", textCount: 0 });
    } catch (error) {
      this.setData({ actionPending: false, loadError: this.cloudErrorMessage(error) });
      if (error && ["VERSION_CONFLICT", "REVIEW_ALREADY_SUBMITTED"].includes(error.code)) this.load();
      else wx.showToast({ title: this.cloudErrorMessage(error), icon: "none" });
    }
  },

  retryLoad() { this.load(); },
  cloudErrorMessage(error) {
    const messages = {
      ORDER_NOT_FOUND: "没有找到这笔订单。", VERSION_CONFLICT: "订单已变化，正在刷新。",
      REVIEW_ALREADY_SUBMITTED: "该订单已经评价，正在刷新。", REVIEW_RATING_INVALID: "请选择 1—5 星评分。",
      ORDER_ROLE_FORBIDDEN: "只有本订单需求方可以评价。", ILLEGAL_TRANSITION: "只有已完成订单可以评价。"
    };
    return messages[error && error.code] || "评价提交失败，请稍后重试。";
  },

  goOrders() { wx.switchTab({ url: "/pages/orders/index" }); }
});
