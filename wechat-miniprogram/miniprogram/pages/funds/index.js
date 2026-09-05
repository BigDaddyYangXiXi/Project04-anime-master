const cloudOrders = require("../../services/cloud-orders");

function formatCents(value) {
  return Number.isSafeInteger(value) && value >= 0 ? `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}` : "—";
}
function chinaTime(value) {
  return new Date(value + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}
const MERCHANT_COPY = {
  NOT_STARTED: "收款资料尚未开通，需完成资料提交与核验。",
  PENDING: "收款资料待核验，核验结果确认后再开放收款。",
  READY: "收款资料已核验；支付与结算能力开放情况以平台通知为准。",
  SUSPENDED: "收款资格暂不可用，需要完成处理并重新核验。"
};

Page({
  data: { records: [], loading: false, loadingMore: false, loadError: "", moreError: "", loaded: false,
    nextCursor: null, merchantCopy: "", settlementCopy: "结算功能尚未开放；付款记录不代表已结算或可提现金额。" },
  onShow() { return this.load(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    const request = this.request = (this.request || 0) + 1;
    this.setData({ loading: true, loadingMore: false, loadError: "", moreError: "", loaded: false, records: [], nextCursor: null, merchantCopy: "" });
    try {
      const response = await cloudOrders.getProviderFunds();
      if (request !== this.request) return;
      this.renderResponse(response, false);
      this.setData({ loaded: true });
    } catch (error) {
      if (request === this.request) this.setData({ loadError: error.code === "PROVIDER_ROLE_REQUIRED" ? "仅服务方可查看自己的资金记录。"
        : ["ACCOUNT_NOT_FOUND", "AUTH_CONTEXT_MISSING"].includes(error.code) ? "请先登录后查看自己的资金记录。" : "暂时无法读取资金记录，请稍后重试。" });
    } finally { if (request === this.request) this.setData({ loading: false }); }
  },
  async loadMore() {
    if (!this.data.nextCursor || this.data.loading || this.data.loadingMore) return;
    const request = this.request;
    this.setData({ loadingMore: true, moreError: "" });
    try {
      const response = await cloudOrders.getProviderFunds(this.data.nextCursor);
      if (request === this.request) this.renderResponse(response, true);
    } catch {
      if (request === this.request) this.setData({ moreError: "更多记录读取失败，已显示的记录仍保留。" });
    } finally { if (request === this.request) this.setData({ loadingMore: false }); }
  },
  renderResponse(response, append) {
    const records = response.records.map((record) => ({ ...record, amountText: record.currency === "CNY" ? `￥${formatCents(record.totalFen)}` : "金额待核对",
      timeText: chinaTime(record.paidAt), statusText: record.status === "PAID" ? "付款已确认" : "付款待核对",
      needsReview: record.status === "PAID_REQUIRES_REVIEW" }));
    this.setData({ records: append ? [...new Map([...this.data.records, ...records].map((row) => [row.id, row])).values()] : records,
      nextCursor: response.nextCursor, merchantCopy: MERCHANT_COPY[response.merchantStatus] || "收款资料状态暂不可用，请刷新重试。" });
  },
  openOrder(event) {
    const record = this.data.records.find((row) => row.id === event.currentTarget.dataset.id);
    if (record) wx.navigateTo({ url: `/pages/provider-request/index?id=${encodeURIComponent(record.orderId)}` });
  }
});

module.exports = { formatCents };
