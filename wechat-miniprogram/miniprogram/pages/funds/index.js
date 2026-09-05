const store = require("../../data/v063-store");

function formatCents(value) {
  const cents = Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
  return (cents / 100).toFixed(2);
}

Page({
  data: { verifiedTransactions: [], paidTotal: 0, withdrawableBalance: "0.00", entries: [
    { key: "transactions", title: "交易记录", copy: "查看已核验的支付流水", state: "" },
    { key: "bills", title: "账单", copy: "按订单核对收入明细", state: "" },
    { key: "password", title: "支付密码", copy: "设置或修改支付安全验证", state: "需接入安全能力" }
  ] },
  onShow() {
    const account = store.getFundsAccount();
    const verifiedTransactions = store.getOrders().filter((order) => order.providerId === store.CURRENT_PROVIDER_ID && order.paymentStatus === "PAID" && order.paymentTransactionId && order.paidAt).map((order) => ({ id: order.id, title: order.service, amount: Number(order.finalPrice || 0), time: new Date(order.paidAt).toLocaleDateString() }));
    const entries = this.data.entries.map((entry) => ["transactions", "bills"].includes(entry.key) ? Object.assign({}, entry, { state: `${verifiedTransactions.length} 笔` }) : entry);
    this.setData({ verifiedTransactions, entries, paidTotal: verifiedTransactions.reduce((sum, item) => sum + item.amount, 0), withdrawableBalance: formatCents(account.withdrawableBalanceCents) });
  },
  openEntry(event) {
    const key = event.currentTarget.dataset.key;
    if (["transactions", "bills"].includes(key)) {
      if (!this.data.verifiedTransactions.length) wx.showToast({ title: "暂无已核验流水", icon: "none" });
      return;
    }
    const title = key === "withdraw" ? "提现尚未开通" : key === "recharge" ? "充值尚未开通" : "支付安全能力尚未接入";
    wx.showModal({ title, content: "当前原型不会模拟余额、充值、提现结果或支付密码。接入真实资金账户与安全组件后，此入口将承载对应能力。", showCancel: false });
  }
});

module.exports = { formatCents };
