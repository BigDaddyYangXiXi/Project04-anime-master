const documents = require("../../data/account-notice");

Page({
  data: { title: "用户服务协议与账号规范", version: "", sections: [] },
  onLoad() {
    this.setData(documents.current);
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
    else wx.reLaunch({ url: "/pages/auth/index" });
  },
  jumpToSection(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.sections.length) return;
    wx.pageScrollTo({ selector: `#notice-section-${index}`, duration: 200 });
  }
});
