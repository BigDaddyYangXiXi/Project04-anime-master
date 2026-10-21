const { nativeBrandColor } = require("../data/design-theme");

function confirmAction(page, title, content, onConfirm) {
  if (page.unloaded || page.data.actionPending || !page.data.order) return;
  const { id, version, stage } = page.data.order;
  wx.showModal({
    title,
    content,
    confirmColor: nativeBrandColor,
    success: ({ confirm }) => {
      if (!confirm || page.unloaded || page.data.actionPending) return;
      const current = page.data.order;
      if (!current || current.id !== id || current.version !== version || current.stage !== stage) {
        wx.showToast({ title: "订单已更新，请重新核对后操作", icon: "none" });
        return;
      }
      onConfirm();
    }
  });
}

module.exports = confirmAction;
