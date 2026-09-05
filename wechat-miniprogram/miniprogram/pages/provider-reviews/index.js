const store = require("../../data/v063-store");
const cloudOrders = require("../../services/cloud-orders");

Page({
  data: {
    reviews: [], drafts: {}, rating: "—", ratingBoundary: "综合算法待平台确认", message: "",
    loading: false, loadError: "", pendingId: ""
  },
  onLoad(options) {
    this.auditReply = options.audit === "1" && options.reply === "1";
    this.auditEmpty = options.audit === "1" && options.empty === "1";
    this.cloudMode = options.audit !== "1";
  },
  onShow() { this.refresh(); },
  async refresh() {
    if (this.cloudMode) {
      this.setData({ loading: true, loadError: "" });
      try {
        const orders = await cloudOrders.listOrders();
        this.renderReviews(orders.filter((order) => order.viewerRole === "PROVIDER" && order.stage === "COMPLETED" && order.rating > 0), false);
        this.setData({ loading: false });
      } catch (error) {
        this.setData({ reviews: [], loading: false, loadError: "评价读取失败，请稍后重试。" });
      }
      return;
    }
    let reviews = this.auditEmpty ? [] : store.getOrders().filter((order) => order.providerId === store.CURRENT_PROVIDER_ID && order.rating > 0);
    if (this.auditReply && reviews.length) reviews = reviews.map((order, index) => index === 0
      ? Object.assign({}, order, { reviewReply: "感谢认可，也欢迎下次继续合作。" }) : order);
    this.renderReviews(reviews, true);
  },
  renderReviews(reviews, auditFixture) {
    const rating = reviews.length
      ? (reviews.reduce((sum, order) => sum + order.rating, 0) / reviews.length).toFixed(1)
      : "—";
    this.setData({
      reviews: reviews.map((order) => Object.assign({}, order, { stars: "★".repeat(order.rating) })),
      rating,
      ratingBoundary: auditFixture ? "审计夹具平均值" : reviews.length ? `基于 ${reviews.length} 条已完成订单评价` : "暂无已完成订单评价"
    });
  },
  update(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ drafts: Object.assign({}, this.data.drafts, { [id]: event.detail.value }) });
  },
  reply(event) {
    const id = event.currentTarget.dataset.id;
    const order = this.data.reviews.find((item) => item.id === id);
    if (!order || order.reviewReply) return wx.showToast({ title: "该评价已经回复，不能重复修改", icon: "none" });
    const value = (this.data.drafts[id] || "").trim();
    if (!value) return wx.showToast({ title: "请填写公开回复", icon: "none" });
    wx.showModal({
      title: "确认发布公开回复",
      content: "回复发布后会同步到需求方评价页，且不能再次修改。",
      confirmColor: "#ff7a45",
      success: ({ confirm }) => {
        if (!confirm) return;
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
    if (this.data.pendingId) return;
    this.setData({ pendingId: order.id, loadError: "" });
    try {
      await cloudOrders.transitionOrder(order.id, order.version, "PROVIDER_REPLIES_REVIEW", { reviewReply: value });
      this.setData({ drafts: Object.assign({}, this.data.drafts, { [order.id]: "" }), pendingId: "", message: "公开回复已发布并同步需求方评价页" });
      this.refresh();
    } catch (error) {
      this.setData({ pendingId: "", loadError: error && error.code === "REVIEW_REPLY_ALREADY_SUBMITTED" ? "该评价已经回复，正在刷新。" : "公开回复失败，请稍后重试。" });
      if (error && ["VERSION_CONFLICT", "REVIEW_REPLY_ALREADY_SUBMITTED"].includes(error.code)) this.refresh();
      else wx.showToast({ title: this.data.loadError, icon: "none" });
    }
  },
  retryLoad() { this.refresh(); }
});
