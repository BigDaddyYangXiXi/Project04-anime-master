const cloudOrders = require("../services/cloud-orders");

module.exports = async function openReference() {
  const order = this.data.order;
  if (!order || !order.referenceAssetId || order.privateFieldsHidden || this.referencePending) return;
  this.referencePending = true;
  try {
    const access = await cloudOrders.getReferenceDownload(order.id);
    if (getCurrentPages().slice(-1)[0] !== this || !this.data.order || this.data.order.id !== order.id || this.data.order.privateFieldsHidden) return;
    await new Promise((resolve, reject) => wx.previewImage({ urls: [access.url], success: resolve, fail: reject }));
  } catch (error) {
    if (getCurrentPages().slice(-1)[0] !== this) return;
    if (!/cancel/i.test(String(error && error.errMsg || ""))) wx.showToast({ title: error && error.code === "NDA_REQUIRED" ? "请先完成双方保密签署" : "参考图暂时无法打开，请重试", icon: "none" });
  } finally { this.referencePending = false; }
};
