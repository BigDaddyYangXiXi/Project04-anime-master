const availability = require('../../services/cloud-availability');
const catalog = require('../../services/cloud-catalog');
const calendar = require('../../data/calendar-model');
Page({
  data: { weekdays: ['一','二','三','四','五','六','日'], days: [], originalDates: [], draftDates: [], lockedDates: [],
    monthTitle: '', monthOffset: 0, version: 0, accepting: true, originalAccepting: true, changed: false, loading: false, saving: false, error: '', message: '' },
  onLoad() { this.month = calendar.monthFrom(); this.refresh(); },
  onShow() { this.hidden = false; this.load(); },
  onHide() { this.hidden = true; this.request = (this.request || 0) + 1; },
  onUnload() { this.unloaded = true; this.onHide(); },
  async load() {
    if (this.data.saving) return;
    const owner = getApp().globalData.account?.id, request = this.request = (this.request || 0) + 1;
    const current = () => !this.unloaded && !this.hidden && this.request === request && owner === getApp().globalData.account?.id;
    if (this.owner !== owner) { this.owner = owner; this.setData({ originalDates: [], draftDates: [], lockedDates: [], version: 0, changed: false, days: [] }); }
    this.setData({ loading: true, error: '' });
    try {
      const [value, draft] = await Promise.all([availability.getMine(), catalog.getDraft()]);
      if (!current()) return;
      const accepting = typeof value.accepting === 'boolean' ? value.accepting : draft.clientDraft.profile.accepting !== false;
      const preserve = this.data.changed && this.data.version === value.version;
      this.setData({ loading: false, version: value.version, originalDates: value.openDates, lockedDates: value.lockedDates, originalAccepting: accepting,
        ...(preserve ? {} : { draftDates: [...value.openDates], accepting }) });
      this.refresh();
    } catch (_) { if (current()) this.setData({ loading: false, error: '档期未能读取，已编辑内容保留，请重试。' }); }
  },
  refresh() {
    this.setData({ monthTitle: this.month.title,
      changed: JSON.stringify([...this.data.originalDates].sort()) !== JSON.stringify([...this.data.draftDates].sort()) || this.data.accepting !== this.data.originalAccepting,
      days: calendar.buildMonth({ ...this.month, openDates: this.data.draftDates, lockedDates: this.data.lockedDates }) });
  },
  changeMonth(event) {
    const offset = this.data.monthOffset + Number(event.currentTarget.dataset.step);
    if (this.data.saving || offset < 0 || offset > 11) return;
    const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() + offset);
    this.month = calendar.monthFrom(null, date); this.setData({ monthOffset: offset }); this.refresh();
  },
  toggle(event) {
    const date = event.currentTarget.dataset.date;
    if (this.data.saving || this.data.loading || !date || date < calendar.todayKey() || this.data.lockedDates.includes(date)) return;
    const draftDates = this.data.draftDates.includes(date) ? this.data.draftDates.filter(item => item !== date) : [...this.data.draftDates, date];
    this.setData({ draftDates, message: '' }); this.refresh();
  },
  changeAccepting(event) { if (!this.data.saving && !this.data.loading) { this.setData({ accepting: event.detail.value }); this.refresh(); } },
  reset() { if (!this.data.saving) { this.setData({ draftDates: [...this.data.originalDates], accepting: this.data.originalAccepting, message: '' }); this.refresh(); } },
  back() {
    if (this.data.saving) return;
    if (!this.data.changed) return wx.navigateBack();
    const owner = this.owner;
    wx.showActionSheet({ itemList: ['保存并返回', '继续编辑', '放弃修改并返回'], success: async ({tapIndex}) => {
      if (this.unloaded || this.data.saving || owner !== getApp().globalData.account?.id) return;
      if (tapIndex === 2) return wx.navigateBack();
      if (tapIndex === 0) { await this.save(); if (!this.unloaded && !this.data.changed && owner === getApp().globalData.account?.id) wx.navigateBack(); }
    } });
  },
  async save() {
    if (this.unloaded || this.hidden || this.data.loading || this.data.saving || !this.data.changed) return;
    const owner = this.owner, request = this.request = (this.request || 0) + 1;
    const current = () => !this.unloaded && !this.hidden && request === this.request && owner === getApp().globalData.account?.id;
    this.setData({ saving: true, error: '' });
    try {
      const dates = this.data.draftDates.filter(date => date >= calendar.todayKey()).sort();
      const result = await availability.saveMine(this.data.version, dates, this.data.accepting);
      if (!current()) return;
      this.setData({ version: result.version, originalDates: result.openDates, draftDates: [...result.openDates], lockedDates: result.lockedDates,
        accepting: result.accepting, originalAccepting: result.accepting, message: '已保存并生效，已有订单不受影响。' });
      catalog.clearStorefrontState(); this.refresh();
    } catch (error) { if (current()) this.setData({ error: error.code === 'VERSION_CONFLICT' ? '档期已在其他页面修改，请重新读取后核对。' : '保存失败，修改已保留，请重试。' }); }
    finally { if (!this.unloaded) this.setData({ saving: false }); }
  }
});
