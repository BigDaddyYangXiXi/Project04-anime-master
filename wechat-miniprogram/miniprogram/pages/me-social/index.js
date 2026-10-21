const saved = require('../../services/cloud-saved-items');
Page({
  data: { navWorkspace: 'buyer', type: 'likes', title: '收到的喜欢', items: [], loading: false, ready: false, error: '', cursor: null },
  onLoad(options = {}) { this.setData({ navWorkspace: wx.getStorageSync('animeMasterRole') === 'provider' ? 'provider' : 'buyer' }); const type = options.type === 'followers' ? 'followers' : 'likes'; this.setData({ type, title: type === 'likes' ? '收到的喜欢' : '关注我的' }); },
  onShow() { this.active = true; const owner = getApp().globalData.account?.id; if (owner !== this.owner || !owner) { this.request = (this.request || 0) + 1; this.setData({ items: [], ready: false, cursor: null, loading: false, error: '' }); } this.owner = owner; if (owner) this.load(); },
  onHide() { this.active = false; this.request = (this.request || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async load(event) {
    if (!this.active || !this.owner || this.owner !== getApp().globalData.account?.id || this.data.loading) return;
    const more = event?.currentTarget?.dataset.more === '1', owner = this.owner, request = this.request = (this.request || 0) + 1;
    if (!owner || more && this.data.cursor === null) return;
    this.setData({ loading: true, error: '', ...(more ? {} : { items: [], ready: false }) });
    try {
      const result = await saved.listReceived(this.data.type, more ? this.data.cursor : null);
      if (!this.active || request !== this.request || owner !== getApp().globalData.account?.id) return;
      const items = (more ? this.data.items : []).concat(result.items).filter((item, i, all) => all.findIndex(x => x.id === item.id) === i);
      this.setData({ items, loading: false, ready: true, cursor: result.cursor });
    } catch (_) { if (this.active && request === this.request && owner === getApp().globalData.account?.id) this.setData({ loading: false, error: '互动明细暂时无法读取，请重试。' }); }
  },
  openWork(event) { const work = this.data.items.find(w => w.id === event.currentTarget.dataset.id); if (this.active && this.owner === getApp().globalData.account?.id && work && this.data.type === 'likes') wx.navigateTo({ url: '/pages/work-detail/index?workspace=provider&providerId=' + encodeURIComponent(work.providerId) + '&id=' + encodeURIComponent(work.id) }); }
});
