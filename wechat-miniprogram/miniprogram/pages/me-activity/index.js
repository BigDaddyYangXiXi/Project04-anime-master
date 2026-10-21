const cloudOrders = require('../../services/cloud-orders');
const activity = require('../../data/me-activity');
const presentation = require('../../data/order-presentation');
Page({
  data: { navWorkspace: 'buyer', role: 'buyer', mode: 'coops', title: '合作', description: '', items: [], loading: false, error: '', ready: false, filter: 'all' },
  onLoad(options = {}) { this.mode = ['coops', 'todo', 'reviews'].includes(options.mode) ? options.mode : 'coops'; },
  onShow() {
    const role = wx.getStorageSync('animeMasterRole') === 'provider' ? 'provider' : 'buyer';
    const mode = this.mode;
    this.setData({ navWorkspace: role, role, mode, title: mode === 'reviews' ? '合作评价' : mode === 'todo' ? '待办订单' : role === 'buyer' ? '我发起的合作' : '我承接的合作',
      description: mode === 'reviews' ? '完成验收后可评价，已发布的评价不能修改。' : mode === 'todo' ? '需要你处理的预约、确认与评价；完整进度请查看订单。' : role === 'buyer' ? '统计已提交的合作请求，包含未达成的预约，不包含草稿。' : '统计已进入执行阶段及已完成的合作，预约沟通不计入。' });
    this.refresh();
  },
  onHide() { this.request = (this.request || 0) + 1; },
  onUnload() { this.onHide(); },
  async refresh() {
    const request = this.request = (this.request || 0) + 1, owner = getApp().globalData.account?.id;
    this.owner = owner;
    this.orders = [];
    this.setData({ loading: true, ready: false, error: '', items: [] });
    try {
      if (!owner) throw new Error('no account');
      const orders = await cloudOrders.listOrders();
      if (request !== this.request || owner !== getApp().globalData.account?.id) return;
      this.orders = activity.select(orders, this.data.role, this.data.mode);
      this.renderItems();
      this.setData({ loading: false, ready: true });
    } catch (e) { if (request === this.request && owner === getApp().globalData.account?.id) this.setData({ loading: false, error: '读取失败，请重试。' }); }
  },
  renderItems() {
    const items = (this.orders || []).filter(o => this.data.mode !== 'reviews' || this.data.filter === 'all' || (this.data.filter === 'pending' ? !o.rating : o.rating > 0))
      .map(o => ({ ...presentation.enrichOrder(o, this.data.role === 'buyer' ? 'provider' : 'buyer'), reviewLabel: o.rating ? `${o.rating}星 · 已评价` : '待评价' }));
    this.setData({ items });
  },
  filter(event) { this.setData({ filter: event.currentTarget.dataset.filter }); this.renderItems(); },
  open(event) {
    if (!this.owner || this.owner !== getApp().globalData.account?.id) return;
    const order = (this.orders || []).find(o => o.id === event.currentTarget.dataset.id);
    if (order) wx.navigateTo({ url: activity.destination(order, this.data.role, this.data.mode) });
  },
  openOrders() { wx.switchTab({ url: '/pages/orders/index' }); }
});
