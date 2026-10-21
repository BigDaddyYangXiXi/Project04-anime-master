const cloudAccount = require('../../services/cloud-account');
const { requestOrderSubscription } = require('../../services/order-subscription');
const { nativeBrandColor } = require('../../data/design-theme');
const titles = { main: '设置', security: '账号与安全', permissions: '提醒与权限', privacy: '协议与隐私', about: '关于万匠屋' };
Page({
  data: { navWorkspace: 'buyer', section: 'main', title: '设置', username: '', nickname: '', location: '尚未读取', message: '', loading: false, version: '' },
  onLoad(options = {}) { this.setData({ navWorkspace: wx.getStorageSync('animeMasterRole') === 'provider' ? 'provider' : 'buyer' }); const section = titles[options.section] ? options.section : 'main'; this.setData({ section, title: titles[section] }); },
  onShow() {
    this.active = true;
    this.generation = (this.generation || 0) + 1;
    this.owner = getApp().globalData.account?.id;
    this.setData({ username: '', nickname: '', message: '', loading: false });
    if (this.data.section === 'security') this.loadAccount();
    if (this.data.section === 'permissions') this.readPermission();
    if (this.data.section === 'about') {
      const info = wx.getAccountInfoSync?.().miniProgram;
      this.setData({ version: info?.version || '开发版' });
    }
  },
  onHide() { this.active = false; this.generation = (this.generation || 0) + 1; },
  onUnload() { this.onHide(); },
  current(generation = this.generation) { return generation === this.generation && this.active && this.owner === getApp().globalData.account?.id; },
  async loadAccount() {
    const generation = this.generation;
    try { const account = await cloudAccount.getMine(); if (this.current(generation)) this.setData({ username: account.username ? '@' + account.username : '', nickname: account.nickname }); }
    catch (_) { if (this.current(generation)) this.setData({ message: '账号信息读取失败，请重试。' }); }
  },
  open(event) { wx.navigateTo({ url: '/pages/settings/index?section=' + event.currentTarget.dataset.section }); },
  edit() { wx.navigateTo({ url: '/pages/account-profile/index?role=' + (wx.getStorageSync('animeMasterRole') === 'provider' ? 'provider' : 'buyer') }); },
  request(event) { wx.navigateTo({ url: '/pages/support/index?kind=' + event.currentTarget.dataset.kind }); },
  agreement() { wx.navigateTo({ url: '/pages/account-notice/index' }); },
  privacy() { if (!wx.openPrivacyContract) return this.setData({ message: '当前微信版本不支持，请更新微信后重试。' }); wx.openPrivacyContract({ fail: () => { if (this.current()) this.setData({ message: '暂未打开隐私指引，请重试。' }); } }); },
  contact() { wx.navigateTo({ url: '/pages/help/index?contact=1' }); },
  readPermission() {
    const generation = this.generation, request = this.permissionRequest = (this.permissionRequest || 0) + 1;
    wx.getSetting({ success: result => { if (this.current(generation) && request === this.permissionRequest) this.setData({ location: result.authSetting['scope.userFuzzyLocation'] === true ? '已允许' : result.authSetting['scope.userFuzzyLocation'] === false ? '未允许，可在微信设置中调整' : '尚未授权' }); }, fail: () => { if (this.current(generation) && request === this.permissionRequest) this.setData({ location: '读取失败，请重试' }); } });
  },
  openPermission() { wx.openSetting({ success: () => { if (this.current()) this.readPermission(); }, fail: () => { if (this.current()) this.setData({ message: '未打开微信设置，请重试。' }); } }); },
  async subscribe() {
    if (this.data.loading) return;
    const generation = this.generation;
    this.setData({ loading: true, message: '' });
    const result = await requestOrderSubscription(wx);
    if (!this.current(generation)) return;
    const copy = { accept: '本次订阅已同意。', reject: '未订阅，不影响订单操作。', ban: '通知已关闭，可在微信设置中调整。', filter: '当前模板暂不可订阅。', unavailable: '当前微信版本不支持。', failed: '订阅未完成，请重试。' };
    this.setData({ loading: false, message: copy[result.status] || copy.failed });
  },
  logout() {
    const generation = this.generation;
    wx.showModal({ title: '退出登录', content: '退出当前账号，不会删除订单、作品或已提交的申请。', confirmColor: nativeBrandColor, success: ({ confirm }) => {
      if (!confirm || !this.current(generation)) return;
      wx.setStorageSync('animeMasterSignedOut', true);
      getApp().clearServerSession();
      getApp().globalData.pendingRoute = '';
      wx.reLaunch({ url: '/pages/auth/index?signedOut=1' });
    } });
  }
});
