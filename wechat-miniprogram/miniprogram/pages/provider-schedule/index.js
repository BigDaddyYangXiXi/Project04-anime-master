const { findProvider } = require("../../data/catalog");
const { availability } = require("../../data/v063");
const store = require("../../data/v063-store");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudAvailability = require("../../services/cloud-availability");
const calendarModel = require("../../data/calendar-model");
const LOCKED_STAGES = ["AGREEMENT_PENDING", "PAID", "IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"];

function buildMonth(providerId, selectedDay) {
  const providerAvailability = availability[providerId] || { available: [], full: [] };
  const availableDays = providerId === store.CURRENT_PROVIDER_ID ? store.getAvailableDays() : providerAvailability.available;
  const orderLockedDays = providerId === store.CURRENT_PROVIDER_ID ? store.getOrders()
    .filter((order) => order.providerId === providerId && LOCKED_STAGES.includes(order.stage))
    .map((order) => Number((order.time.match(/2026[/-]08[/-](\d{2})/) || [])[1]))
    .filter(Boolean) : [];
  const fullDays = new Set(providerAvailability.full.concat(orderLockedDays));
  return Array.from({ length: 42 }, (_, index) => {
    const value = index - 4;
    const valid = value > 0 && value <= 31;
    const past = valid && value < 16;
    const full = valid && fullDays.has(value);
    const open = valid && availableDays.includes(value);
    const state = full ? "full" : open ? "open" : "unknown";
    return { key: index, value: valid ? value : "", valid, past, full, state, label: full ? "满客" : open ? "可约" : "未公开", selectable: valid && !past && !full, selected: value === selectedDay };
  });
}

Page({
  data: { provider: null, weekdays: ["一", "二", "三", "四", "五", "六", "日"], days: [], selectedDay: 16, selectedDate: "", selectedFull: false, selectedLabel: "公开可约", selectedText: "8 月 16 日 · 公开可约", bookingText: "使用 8 月 16 日发起预约", monthTitle: "2026 年 8 月", loading: false, loadError: "", navWorkspace: "buyer" },
  onLoad(options) {
    this.providerPreview = options.workspace === "provider";
    this.setData({ navWorkspace: this.providerPreview ? "provider" : "buyer" });
    this.cloudMode = options.audit !== "1";
    if (this.cloudMode) { this.loadCloud(options); return; }
    const catalogProvider = findProvider(options.id);
    if (!catalogProvider) return wx.showToast({ title: "没有找到服务者", icon: "none" });
    const profile = catalogProvider.id === store.CURRENT_PROVIDER_ID ? store.getProfile() : null;
    const provider = Object.assign({}, catalogProvider, profile ? { name: profile.nickname, city: profile.city } : {});
    const providerAvailability = availability[provider.id] || { full: [] };
    const requestedDay = Number(options.day || 16);
    const selectedDay = requestedDay >= 16 && requestedDay <= 31 && !providerAvailability.full.includes(requestedDay) ? requestedDay : 16;
    this.setData({ provider, selectedDay }, () => this.refresh());
  },
  refresh() {
    if (this.cloudMode) {
      const days = calendarModel.buildMonth({ ...this.calendarMonth, openDates: this.openDates, lockedDates: this.lockedDates, selectedDate: this.data.selectedDate });
      const selected = days.find((item) => item.date === this.data.selectedDate);
      const selectedText = selected ? `${this.calendarMonth.month} 月 ${selected.value} 日 · ${selected.label}` : "未选择";
      this.setData({ days, selectedFull: Boolean(selected && selected.full), selectedLabel: selected ? selected.label : "未选择", selectedText, bookingText: selected ? `使用 ${this.calendarMonth.month} 月 ${selected.value} 日发起预约` : "请选择合作日期" });
      return;
    }
    const days = buildMonth(this.data.provider.id, this.data.selectedDay);
    const selected = days.find((item) => item.value === this.data.selectedDay);
    this.setData({ days, selectedFull: Boolean(selected && selected.full), selectedLabel: selected ? selected.label : "未选择", selectedText: selected ? `8 月 ${selected.value} 日 · ${selected.label}` : "未选择", bookingText: selected ? `使用 8 月 ${selected.value} 日发起预约` : "请选择合作日期" });
  },
  async loadCloud(options) {
    this.setData({ loading: true, loadError: "" });
    try {
      const [{ provider }, availabilityValue] = await Promise.all([cloudCatalog.getProvider(options.id), cloudAvailability.getPublic(options.id)]);
      if (!provider) { this.setData({ loading: false, loadError: "没有找到服务者档期" }); return; }
      const requested = /^\d{4}-\d{2}-\d{2}$/.test(options.date || "") ? options.date : calendarModel.todayKey();
      this.calendarMonth = calendarModel.monthFrom(requested);
      this.openDates = availabilityValue.openDates;
      this.lockedDates = availabilityValue.lockedDates;
      this.setData({ provider: { id: provider.id, name: provider.nickname, career: provider.career }, selectedDate: requested, selectedDay: Number(requested.slice(-2)), monthTitle: this.calendarMonth.title, loading: false }, () => this.refresh());
    } catch (error) {
      this.setData({ provider: null, loading: false, loadError: "档期读取失败，请稍后重试。" });
    }
  },
  chooseDate(event) {
    if (this.cloudMode) { this.setData({ selectedDate: event.currentTarget.dataset.date, selectedDay: Number(event.currentTarget.dataset.day) }, () => this.refresh()); return; }
    this.setData({ selectedDay: Number(event.currentTarget.dataset.day) }, () => this.refresh());
  },
  startBooking() {
    if (this.providerPreview) return wx.showToast({ title: "档期预览中不可发起预约", icon: "none" });
    if (!this.data.selectedDay || this.data.selectedFull) return;
    const date = this.cloudMode ? this.data.selectedDate : `2026-08-${String(this.data.selectedDay).padStart(2, "0")}`;
    wx.navigateTo({ url: `/pages/booking/index?providerId=${this.data.provider.id}&date=${date}` });
  }
});

module.exports = { buildMonth };
