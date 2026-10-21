const cloudbase = require("./config/cloudbase");
const localPreview = require("./utils/local-preview");

const AUTH_ROUTE = "pages/auth/index";
const DEFAULT_ROUTE = "/pages/discover/index";

function openAuth() {
  const pages = getCurrentPages();
  if (pages[pages.length - 1]?.route !== AUTH_ROUTE) wx.reLaunch({ url: '/' + AUTH_ROUTE });
}

function routeFromLaunch(options = {}) {
  if (!options.path || options.path === AUTH_ROUTE) return "";
  const query = Object.keys(options.query || {})
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options.query[key])}`)
    .join("&");
  return `/${options.path}${query ? `?${query}` : ""}`;
}

function redirectToAuth(app, options) {
  if (localPreview.isLocal()) return;
  const route = routeFromLaunch(options);
  if (!route || app.globalData.account || app.sessionRestoring) return;
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
    require("./utils/screen-performance").launch();
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

    const defaultEntry = !options?.path || options.path === AUTH_ROUTE || options.path === 'pages/discover/index';
    if (defaultEntry) {
      this.globalData.pendingRoute = '';
      wx.setStorageSync('animeMasterRole', 'buyer');
    }
    if (wx.getStorageSync('animeMasterSignedOut') === true) { openAuth(); return; }
    const revision = this.sessionRevision = (this.sessionRevision || 0) + 1;
    this.sessionRestoring = true;
    this.sessionReady = require('./services/cloud-auth').getSession().then(session => {
      if (revision !== this.sessionRevision) return { registered: false };
      this.sessionRestoring = false;
      if (session.registered) this.setServerSession(session);
      else openAuth();
      return session;
    }).catch(error => {
      if (revision === this.sessionRevision) {
        this.sessionRestoring = false;
        openAuth();
      }
      throw error;
    });
    this.sessionReady.catch(() => {});
  },
  onShow(options) {
    this.globalData.background = false;
    if (cloudbase.enabled && wx.getStorageSync('animeMasterSignedOut') !== true) require('./services/startup-location').start(this, wx);
    redirectToAuth(this, options);
  },
  onHide() {
    this.globalData.background = true;
    require('./services/startup-location').hide(this);
  },
  setServerSession(session) {
    wx.removeStorageSync('animeMasterSignedOut');
    this.globalData.account = session.account;
    this.globalData.roles = session.roles || [];
    require("./services/cloud-account").seedSession(session);
    require("./services/cloud-catalog").seedSession(session);
    try { wx.setStorageSync("animeMasterServerAccount", session.account); } catch (_) { /* Optional display copy must not reject a confirmed server result. */ }
  },
  clearServerSession() {
    require("./services/background-reads").clearCache();
    require('./services/startup-location').cancel(this);
    this.sessionRevision = (this.sessionRevision || 0) + 1;
    this.sessionRestoring = false;
    this.sessionReady = null;
    require("./services/cloud-account").clearCache();
    require("./services/cloud-saved-items").clearCache();
    require("./utils/display-cache").clear();
    require("./services/cloud-catalog").clearImageCache();
    require("./services/cloud-catalog").clearStorefrontState();
    require("./utils/image-performance").clear();
    require("./utils/cloud-call").clear();
    require("./utils/screen-performance").clear();
    for (const key of ["animeMasterPendingAvatarV1", "animeMasterPublicationIntentV1"]) { try { wx.removeStorageSync(key); } catch (_) {} }
    this.globalData.account = null;
    this.globalData.roles = [];
    try { wx.removeStorageSync("animeMasterServerAccount"); } catch (_) { /* This display copy is never used as session identity. */ }
  },
  takePostAuthRoute() {
    const route = this.globalData.pendingRoute || DEFAULT_ROUTE;
    this.globalData.pendingRoute = "";
    return route;
  },
  globalData: {
    version: "0.7.0-native.16",
    account: null,
    roles: [],
    pendingRoute: ""
  }
});
