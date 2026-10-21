const { nativeBrandColor } = require("../../data/design-theme");
const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const cloudOrders = require("../../services/cloud-orders");

Page({
  data: {
    reviews: [], drafts: {}, rating: "—", ratingBoundary: "综合算法待平台确认", message: "",
    loading: false, loadError: "", pendingId: "", editingReplyId: ""
  },
  onLoad(options) {
    this.auditReply = localPreview.isAudit(options) && options.reply === "1";
    this.auditEmpty = localPreview.isAudit(options) && options.empty === "1";
    this.cloudMode = !localPreview.isAudit(options);
  },
  onShow() { this.refresh(); },
  onUnload() { this.unloaded = true; this.loadRequest = (this.loadRequest || 0) + 1; },
  async refresh() {
    if (this.unloaded) return;
    const request = this.loadRequest = (this.loadRequest || 0) + 1;
    if (this.cloudMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        const orders = await cloudOrders.listOrders();
        if (request !== this.loadRequest) return;
        this.renderReviews(orders.filter((order) => order.viewerRole === "PROVIDER" && order.stage === "COMPLETED" && order.rating > 0));
        this.setData({ loading: false });
      } catch (error) {
        if (request !== this.loadRequest) return;
        this.setData({ reviews: [], loading: false, loadError: "评价读取失败，请稍后重试。" });
      }
      return;
    }
    let reviews = this.auditEmpty ? [] : store.getOrders().filter((order) => order.providerId === store.CURRENT_PROVIDER_ID && order.rating > 0);
    if (this.auditReply && reviews.length) reviews = reviews.map((order, index) => index === 0
      ? Object.assign({}, order, { reviewReply: "感谢认可，也欢迎下次继续合作。" }) : order);
    this.renderReviews(reviews);
  },
  renderReviews(reviews) {
    const rating = reviews.length
      ? (reviews.reduce((sum, order) => sum + order.rating, 0) / reviews.length).toFixed(1)
      : "—";
    this.setData({
      reviews: reviews.map((order) => Object.assign({}, order, { stars: "★".repeat(order.rating) })),
      rating,
      ratingBoundary: reviews.length ? `基于 ${reviews.length} 条已完成订单评价` : "暂无已完成订单评价"
    });
  },
  update(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ drafts: Object.assign({}, this.data.drafts, { [id]: event.detail.value }) });
  },
  toggleReply(event) {
    if (this.data.pendingId) return;
    const id = event.currentTarget.dataset.id;
    const review = this.data.reviews.find((item) => item.id === id);
    if (!review || review.reviewReply) return;
    this.setData({ editingReplyId: this.data.editingReplyId === id ? "" : id });
  },
  reply(event) {
    if (this.unloaded || this.data.pendingId) return;
    const id = event.currentTarget.dataset.id;
    const order = this.data.reviews.find((item) => item.id === id);
    if (!order || order.reviewReply) return wx.showToast({ title: "该评价已经回复，不能重复修改", icon: "none" });
    const value = (this.data.drafts[id] || "").trim();
    if (!value) return wx.showToast({ title: "请填写公开回复", icon: "none" });
    wx.showModal({
      title: "确认发布公开回复",
      content: "回复发布后会同步到需求方评价页，且不能再次修改。",
      confirmColor: nativeBrandColor,
      success: ({ confirm }) => {
        if (!confirm || this.unloaded || this.data.pendingId) return;
        const current = this.data.reviews.find((item) => item.id === id);
        if (!current || current.version !== order.version || current.reviewReply) {
          wx.showToast({ title: "评价已更新，请重新核对后回复", icon: "none" });
          return;
        }
        if (this.cloudMode) return this.replyCloud(order, value);
        const latest = store.findOrder(id);
        if (!latest || latest.reviewReply) return wx.showToast({ title: "该评价已经回复", icon: "none" });
        store.updateOrder(id, { reviewReply: value });
        this.setData({ drafts: Object.assign({}, this.data.drafts, { [id]: "" }), message: "公开回复已发布并同步需求方评价页" });
        this.refresh();
      }
    });
  },
  async replyCloud(order, value) {
    if (this.unloaded || this.data.pendingId) return;
    this.setData({ pendingId: order.id, loadError: "" });
    try {
      await cloudOrders.transitionOrder(order.id, order.version, "PROVIDER_REPLIES_REVIEW", { reviewReply: value });
      if (this.unloaded) return;
      this.setData({ drafts: Object.assign({}, this.data.drafts, { [order.id]: "" }), pendingId: "", message: "公开回复已发布并同步需求方评价页" });
      this.refresh();
    } catch (error) {
      if (this.unloaded) return;
      this.setData({ pendingId: "", loadError: error && error.code === "REVIEW_REPLY_ALREADY_SUBMITTED" ? "该评价已经回复，正在刷新。" : "公开回复失败，请稍后重试。" });
      if (error && ["VERSION_CONFLICT", "REVIEW_REPLY_ALREADY_SUBMITTED"].includes(error.code)) this.refresh();
      else wx.showToast({ title: this.data.loadError, icon: "none" });
    }
  },
  retryLoad() { this.refresh(); }
});
