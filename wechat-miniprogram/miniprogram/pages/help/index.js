const articles = require('../../data/help-content');
const links = { start: '/pages/discover/index', 'buyer-order': '/pages/orders/index', refund: '/pages/orders/index', publish: '/pages/provider-profile/index?edit=1&section=profile', request: '/pages/orders/index', funds: '/pages/funds/index', location: '/pages/discover/index', notification: '/pages/settings/index?section=permissions' };
Page({
  data: { navWorkspace: 'buyer', title: '帮助与反馈', article: null, articles: [], contact: false, phone: '13817480520' },
  onLoad(options = {}) {
    this.guide = articles[options.guide] ? options.guide : '';
    const role = wx.getStorageSync('animeMasterRole') === 'provider' ? 'provider' : 'buyer';
    const keys = role === 'buyer' ? ['start', 'buyer-order', 'refund', 'location', 'notification', 'funds'] : ['publish', 'request', 'funds', 'refund', 'notification', 'location'];
    this.setData({ navWorkspace: role, title: options.contact === '1' ? '联系与账号申诉' : this.guide ? '使用指南' : '帮助与反馈', contact: options.contact === '1', article: this.guide ? articles[this.guide] : null,
      articles: keys.map(key => ({ key, title: articles[key].title })) });
  },
  openArticle(event) { wx.navigateTo({ url: '/pages/help/index?guide=' + event.currentTarget.dataset.key }); },
  openRelated() {
    const url = links[this.guide];
    if (!url) return;
    if (['/pages/discover/index', '/pages/orders/index'].includes(url)) wx.switchTab({ url });
    else wx.navigateTo({ url });
  },
  feedback() { wx.navigateTo({ url: '/pages/support/index?guide=' + encodeURIComponent(this.guide || '') }); },
  history() { wx.navigateTo({ url: '/pages/support/index?mode=list' }); },
  contact() { wx.navigateTo({ url: '/pages/help/index?contact=1' }); },
  call() { wx.makePhoneCall({ phoneNumber: this.data.phone, fail() { wx.showToast({ title: '未拨出，可复制号码联系', icon: 'none' }); } }); },
  copy() { wx.setClipboardData({ data: this.data.phone }); }
});
