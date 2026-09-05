const cloudbase = require("./config/cloudbase");

const AUTH_ROUTE = "pages/auth/index";
const DEFAULT_ROUTE = "/pages/discover/index";

function routeFromLaunch(options = {}) {
  if (!options.path || options.path === AUTH_ROUTE) return "";
  const query = Object.keys(options.query || {})
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options.query[key])}`)
    .join("&");
  return `/${options.path}${query ? `?${query}` : ""}`;
}

function redirectToAuth(app, options) {
  const route = routeFromLaunch(options);
  if (!route || app.globalData.account) return;
  app.globalData.pendingRoute = route;
  setTimeout(() => {
    const pages = getCurrentPages();
    const current = pages[pages.length - 1];
    if (!app.globalData.account && current && current.route !== AUTH_ROUTE) {
      wx.reLaunch({ url: `/${AUTH_ROUTE}` });
    }
  }, 0);
}

App({
  onLaunch(options) {
    this.globalData.pendingRoute = routeFromLaunch(options);
    if (!cloudbase.enabled) return;
    if (!cloudbase.env) {
      console.error("CloudBase 已启用，但尚未配置环境 ID");
      return;
    }
    if (!wx.cloud) {
      console.error("当前微信基础库不支持云开发能力");
      return;
    }
    wx.cloud.init({ env: cloudbase.env, traceUser: true });

    redirectToAuth(this, options);
  },
  onShow(options) {
    redirectToAuth(this, options);
  },
  setServerSession(session) {
    this.globalData.account = session.account;
    this.globalData.roles = session.roles || [];
    wx.setStorageSync("animeMasterServerAccount", session.account);
  },
  clearServerSession() {
    this.globalData.account = null;
    this.globalData.roles = [];
    wx.removeStorageSync("animeMasterServerAccount");
  },
  takePostAuthRoute() {
    const route = this.globalData.pendingRoute || DEFAULT_ROUTE;
    this.globalData.pendingRoute = "";
    return route;
  },
  globalData: {
    version: "0.7.0-native.7",
    account: null,
    roles: [],
    pendingRoute: ""
  }
});
