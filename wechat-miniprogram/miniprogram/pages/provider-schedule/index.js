const localPreview = require("../../utils/local-preview");
const { findProvider } = require("../../data/catalog");
const { availability } = require("../../data/v063");
const store = require("../../data/v063-store");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudAvailability = require("../../services/cloud-availability");
const calendarModel = require("../../data/calendar-model");
const { occupiesSlot } = require("../../data/preview-order-slots");

function buildMonth(providerId, selectedDay) {
  const providerAvailability = availability[providerId] || { available: [], full: [] };
  const availableDays = providerId === store.CURRENT_PROVIDER_ID ? store.getAvailableDays() : providerAvailability.available;
  const orderLockedDays = providerId === store.CURRENT_PROVIDER_ID ? store.getOrders()
    .filter((order) => order.providerId === providerId && occupiesSlot(order))
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
  data: { provider: null, weekdays: ["一", "二", "三", "四", "五", "六", "日"], days: [], selectedDay: 16, selectedDate: "", selectedFull: false, canBook: false, selectedLabel: "公开可约", selectedText: "8 月 16 日 · 公开可约", bookingText: "使用 8 月 16 日发起预约", monthTitle: "2026 年 8 月", loading: false, loadError: "", navWorkspace: "buyer" },
  onLoad(options) {
    this.providerPreview = options.workspace === "provider";
    this.setData({ navWorkspace: this.providerPreview ? "provider" : "buyer", providerPreview: this.providerPreview, monthOffset: 0 });
    this.cloudMode = !localPreview.isAudit(options);
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
      const days = calendarModel.buildMonth({ ...this.calendarMonth, openDates: this.openDates, lockedDates: this.lockedDates, selectedDate: this.data.selectedDate, today: calendarModel.todayKey() });
      const selected = days.find((item) => item.date === this.data.selectedDate);
      const selectedText = selected ? `${this.calendarMonth.month} 月 ${selected.value} 日 · ${selected.label}` : "未选择";
      this.setData({ days, selectedFull: Boolean(selected && selected.full), canBook: Boolean(selected && selected.selectable), selectedLabel: selected ? selected.label : "未选择", selectedText, bookingText: selected ? `使用 ${this.calendarMonth.month} 月 ${selected.value} 日发起预约` : "请选择合作日期" });
      return;
    }
    const days = buildMonth(this.data.provider.id, this.data.selectedDay);
    const selected = days.find((item) => item.value === this.data.selectedDay);
    this.setData({ days, selectedFull: Boolean(selected && selected.full), canBook: Boolean(selected && selected.selectable), selectedLabel: selected ? selected.label : "未选择", selectedText: selected ? `8 月 ${selected.value} 日 · ${selected.label}` : "未选择", bookingText: selected ? `使用 8 月 ${selected.value} 日发起预约` : "请选择合作日期" });
  },
  async loadCloud(options) {
    if (this.unloaded) return;
    this.loadOptions = { id: options.id, date: options.date };
    const request = this.loadRequest = (this.loadRequest || 0) + 1;
    const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
    this.setData({ loading: true, loadError: "" });
    try {
      const ownPreview = this.providerPreview && owner && String(owner) === String(options.id);
      const [{ provider }, availabilityValue] = await Promise.all([
        ownPreview ? cloudCatalog.getDraft().then(value => ({provider: {id:value.providerId,nickname:value.clientDraft.profile.nickname,career:value.clientDraft.career}})) : cloudCatalog.getProvider(options.id),
        ownPreview ? cloudAvailability.getMine() : cloudAvailability.getPublic(options.id)
      ]);
      if (this.unloaded || request !== this.loadRequest || owner !== (typeof getApp === 'function' ? getApp().globalData.account?.id : null)) return;
      if (!provider) { this.setData({ provider: null, canBook: false, loading: false, loadError: "没有找到服务者档期" }); return; }
      const date = options.date || "", parsed = new Date(date + "T00:00:00Z"), today = calendarModel.todayKey();
      const requested = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime())
        && parsed.toISOString().slice(0, 10) === date && date >= today ? date : today;
      this.calendarMonth = calendarModel.monthFrom(requested);
      this.openDates = availabilityValue.openDates;
      this.lockedDates = availabilityValue.lockedDates;
      this.setData({ provider: { id: provider.id, name: provider.nickname, career: provider.career }, selectedDate: requested, selectedDay: Number(requested.slice(-2)), monthTitle: this.calendarMonth.title, loading: false }, () => this.refresh());
    } catch (error) {
      if (request !== this.loadRequest) return;
      this.setData({ provider: null, canBook: false, loading: false, loadError: "档期读取失败，请稍后重试。" });
    }
  },
  onUnload() { this.unloaded = true; this.loadRequest = (this.loadRequest || 0) + 1; },
  changePreviewMonth(event) {
    const offset = this.data.monthOffset + Number(event.currentTarget.dataset.step);
    if (!this.providerPreview || this.data.loading || offset < 0 || offset > 11) return;
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() + offset);
    this.calendarMonth = calendarModel.monthFrom(null, date);
    this.setData({monthOffset:offset,monthTitle:this.calendarMonth.title}); this.refresh();
  },
  returnToPreview() { wx.navigateBack(); },
  retryLoad() { if (this.loadOptions) return this.loadCloud(this.loadOptions); },
  chooseDate(event) {
    if (!this.data.provider || this.data.loading) return;
    this.refresh();
    const selected = this.data.days.find(item => this.cloudMode ? item.date === event.currentTarget.dataset.date : item.value === Number(event.currentTarget.dataset.day));
    if (!selected || !selected.selectable) return;
    if (this.cloudMode) { this.setData({ selectedDate: event.currentTarget.dataset.date, selectedDay: Number(event.currentTarget.dataset.day) }, () => this.refresh()); return; }
    this.setData({ selectedDay: Number(event.currentTarget.dataset.day) }, () => this.refresh());
  },
  startBooking() {
    if (this.unloaded) return;
    if (this.providerPreview) return wx.showToast({ title: "档期预览中不可发起预约", icon: "none" });
    if (!this.data.provider || this.data.loading) return;
    this.refresh();
    if (!this.data.canBook) return;
    const date = this.cloudMode ? this.data.selectedDate : `2026-08-${String(this.data.selectedDay).padStart(2, "0")}`;
    wx.navigateTo({ url: `/pages/booking/index?providerId=${this.data.provider.id}&date=${date}` });
  }
});

module.exports = { buildMonth };
