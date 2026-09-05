const store = require("../../data/v063-store");
const LOCKED_STAGES = ["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"];

Page({
  data: {
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    days: [], originalDays: [], draftDays: [], lockedDays: [], changed: false, message: ""
  },

  onLoad(options) {
    this.auditChanged = options.audit === "1" && options.changed === "1";
    if (options.audit === "1") return;
    this.redirecting = true;
    wx.setStorageSync("animeMasterRole", "provider");
    wx.switchTab({ url: "/pages/projects/index" });
  },

  onShow() {
    if (this.redirecting) return;
    const originalDays = store.getAvailableDays();
    const lockedDays = store.getOrders()
      .filter((order) => order.providerId === store.CURRENT_PROVIDER_ID && LOCKED_STAGES.includes(order.stage))
      .map((order) => Number((order.time.match(/2026[/-]08[/-](\d{2})/) || [])[1]))
      .filter(Boolean);
    const draftDays = [...originalDays];
    if (this.auditChanged && !lockedDays.includes(17) && !draftDays.includes(17)) draftDays.push(17);
    this.setData({ originalDays, lockedDays, draftDays, message: "" }, () => this.refresh());
  },

  refresh() {
    const sortedOriginal = [...this.data.originalDays].sort((a, b) => a - b);
    const sortedDraft = [...this.data.draftDays].sort((a, b) => a - b);
    this.setData({
      changed: JSON.stringify(sortedOriginal) !== JSON.stringify(sortedDraft),
      days: Array.from({ length: 42 }, (_, index) => {
        const value = index - 4;
        const valid = value > 0 && value <= 31;
        return {
          key: index,
          value: valid ? value : "",
          valid,
          open: valid && this.data.draftDays.includes(value),
          locked: valid && this.data.lockedDays.includes(value)
        };
      })
    });
  },

  toggle(event) {
    const value = Number(event.currentTarget.dataset.day);
    if (!value || this.data.lockedDays.includes(value)) return;
    const draftDays = this.data.draftDays.includes(value)
      ? this.data.draftDays.filter((day) => day !== value)
      : this.data.draftDays.concat(value);
    this.setData({ draftDays, message: "" }, () => this.refresh());
  },

  reset() {
    this.setData({ draftDays: [...this.data.originalDays], message: "" }, () => this.refresh());
  },

  save() {
    if (!this.data.changed) return;
    const days = [...this.data.draftDays].sort((a, b) => a - b);
    store.saveAvailableDays(days);
    this.setData({ originalDays: days, message: "公开档期已保存并同步需求方详情" }, () => this.refresh());
  }
});
