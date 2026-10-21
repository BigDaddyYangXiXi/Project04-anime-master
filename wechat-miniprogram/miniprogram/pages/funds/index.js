const cloudOrders = require("../../services/cloud-orders");
const localPreview = require("../../utils/local-preview");
const taxProfile = require('../../services/cloud-tax-profile');
const TAX_COPY = {
  NOT_SUBMITTED: '尚未提交税务资料。资料填写功能开放后，可在此完善。',
  SUBMITTED: '资料已提交，等待核验。', PENDING: '资料审核中。',
  VERIFIED: '资料已审核，结算时仍需核验适用期间与税务规则。',
  REJECTED: '资料未通过审核，需重新核验。', REVOKED: '原审核结果已撤销，需重新核验。'
};

function formatCents(value) {
  return Number.isSafeInteger(value) && value >= 0 ? `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}` : "—";
}
function chinaTime(value) {
  return new Date(value + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}
const MERCHANT_COPY = {
  NOT_STARTED: "个人提现尚未开通，开放后可在此完善实名与收款资料。",
  PENDING: "收款资料待核验，核验结果确认后再开放收款。",
  READY: "收款资料已核验；支付与结算能力开放情况以平台通知为准。",
  SUSPENDED: "收款资格暂不可用，需要完成处理并重新核验。"
};

Page({
  data: { role: "provider", records: [], loading: false, loadingMore: false, loadError: "", moreError: "", loaded: false,
    nextCursor: null, merchantCopy: "", taxCopy: '', taxError: false, settlementCopy: "结算功能尚未开放；付款记录不代表已结算或可提现金额。" },
  onShow() { this.hidden = false; this.setData({ role: wx.getStorageSync("animeMasterRole") === "provider" ? "provider" : "buyer", taxCopy: "", taxError: false }); return Promise.all([this.load(), this.loadTaxStatus()]); },
  onHide() { this.hidden = true; this.request = (this.request || 0) + 1; this.taxRequest = (this.taxRequest || 0) + 1; this.setData({ taxCopy: '', taxError: false }); },
  onUnload() { this.onHide(); },
  async onPullDownRefresh() { try { await Promise.all([this.load(), this.loadTaxStatus()]); } finally { wx.stopPullDownRefresh(); } },
  async loadTaxStatus() {
    if (this.hidden || this.data.role === "buyer") return;
    const request = this.taxRequest = (this.taxRequest || 0) + 1;
    this.setData({ taxCopy: '', taxError: false });
    if (localPreview.isLocal()) return;
    try {
      const response = await taxProfile.getStatus();
      if (request === this.taxRequest) this.setData({ taxCopy: TAX_COPY[response.status] || '', taxError: false });
    } catch (error) {
      if (request !== this.taxRequest) return;
      if (['CLOUD_UNAVAILABLE','TAX_STATUS_NOT_CONFIGURED'].includes(error.code)) return;
      this.setData({ taxCopy: '暂时无法查询税务资料状态。', taxError: true });
    }
  },
  async load() {
    if (this.hidden) return;
    if (this.data.role === "buyer") return this.loadBuyerFunds();
    if (localPreview.isLocal()) {
      this.setData({ loaded: true, loading: false, loadError: "", records: [], nextCursor: null,
        merchantCopy: "本地预览未连接收款账户。", settlementCopy: "当前展示待开通状态，不产生付款或结算。" });
      return;
    }
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
  async loadBuyerFunds() {
    const request = this.request = (this.request || 0) + 1;
    const owner = getApp().globalData.account?.id;
    const current = () => !this.hidden && request === this.request && this.data.role === "buyer" && owner === getApp().globalData.account?.id;
    this.setData({ records: [], nextCursor: null, loading: true, loaded: false, loadError: "", moreError: "" });
    try {
      const orders = await cloudOrders.listOrders();
      if (!current()) return;
      const records = orders.filter(order => order.viewerRole === "BUYER" && (order.paymentStatus === "PAID" || order.paymentStatus === "PAID_REQUIRES_REVIEW" || order.stage === "BUYER_FINAL_CONFIRM"))
        .map(order => ({ id: order.id, orderId: order.id, stage: order.stage, title: order.service || "合作订单", amountText: `￥${formatCents(order.amountFen)}`, statusText: order.paymentStatus === "PAID" ? "付款已确认" : order.paymentStatus === "PAID_REQUIRES_REVIEW" ? "付款待核对" : "待付款" }));
      this.setData({ records, loaded: true });
    } catch (_) { if (current()) this.setData({ loadError: "暂时无法读取订单款项，请重试。" }); }
    finally { if (current()) this.setData({ loading: false }); }
  },
  async loadMore() {
    if (this.data.role === "buyer") return;
    if (this.hidden || !this.data.nextCursor || this.data.loading || this.data.loadingMore) return;
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
    const records = response.records.map((record) => ({ ...record, amountText: record.currency === "CNY" ? `￥${formatCents(record.amountFen)}` : "金额待核对",
      feeText: `￥${formatCents(record.platformFeeFen)}`,
      hasRefund: record.status === 'PAID' && Number.isSafeInteger(record.refundedFen) && record.refundedFen > 0,
      refundText: `￥${formatCents(record.refundedFen)}`,
      retainedFeeText: `￥${formatCents(record.retainedPlatformFeeFen)}`,
      incomeStateText: record.status !== 'PAID' ? '待核对' : record.refundedFen > 0 && record.refundedFen === record.amountFen ? '已全额退款' : '待结算',
      incomeText: record.status === 'PAID' ? `￥${formatCents(record.expectedIncomeFen)}` : '待核对',
      timeText: chinaTime(record.paidAt), statusText: record.status === "PAID" ? "付款已确认" : "付款待核对",
      needsReview: record.status === "PAID_REQUIRES_REVIEW" }));
    this.setData({ records: append ? [...new Map([...this.data.records, ...records].map((row) => [row.id, row])).values()] : records,
      nextCursor: response.nextCursor, merchantCopy: MERCHANT_COPY[response.merchantStatus] || "收款资料状态暂不可用，请刷新重试。" });
  },
  showWithdrawalGuide() {
    wx.showModal({ title: '提现指南', content: '提现功能尚未开放。\n\n后续流程：完善实名与收款资料 → 订单验收通过 → 收益结算 → 提交提现 → 核对到账结果。\n\n订单付款不代表收益已结算。具体到账时间、限额及费用将在开放时说明。', showCancel: false, confirmText: '知道了' });
  },
  openOrder(event) {
    const record = this.data.records.find((row) => row.id === event.currentTarget.dataset.id);
    if (record && this.data.role === "buyer") {
      const route = record.stage === "BUYER_FINAL_CONFIRM" ? "booking-status" : "order-detail";
      return wx.navigateTo({ url: `/pages/${route}/index?id=${encodeURIComponent(record.orderId)}` });
    }
    if (record) wx.navigateTo({ url: `/pages/provider-request/index?id=${encodeURIComponent(record.orderId)}` });
  }
});

module.exports = { formatCents };
