const cloudAuth = require("../../services/cloud-auth");
const localPreview = require("../../utils/local-preview");
const { graphemes, truncateGraphemes } = require("../../utils/input-normalization");

function registrationReady(nickname, username, acceptedNotice) {
  return Boolean(nickname.trim() && /^[\x21-\x7e]{2,12}$/.test(username) && acceptedNotice);
}

const ERROR_MESSAGES = {
  INVALID_USERNAME: "用户名需为2—12个字符，只能包含英文字母、数字和英文标点符号。",
  NICKNAME_TAKEN: "这个昵称已被使用，请换一个。",
  USERNAME_TAKEN: "这个用户名已被使用，请换一个。",
  PHONE_AUTH_REQUIRED: "请授权微信手机号完成注册。",
  REGISTRATION_CONFLICT: "请恢复上次提交的注册资料后重试，或联系客服处理。",
  PRIVACY_REQUIRED: "请同意隐私保护指引后继续注册。",
  PRIVACY_UNAVAILABLE: "暂时无法获取隐私授权，请更新微信或稍后重试。",
  ACCOUNT_NOTICE_OUTDATED: "注册协议已更新，请重新打开小程序并阅读后注册。",
  NICKNAME_REJECTED: "昵称含不适宜内容，请修改后重试。",
  NICKNAME_REVIEW_REQUIRED: "昵称暂未通过审核，请修改后重试。",
  NICKNAME_CHECK_UNAVAILABLE: "暂时无法校验昵称，请稍后重试。",
  ACCOUNT_CLOSED: "账号已注销，无法登录。",
  ACCOUNT_NOT_REGISTERED: "当前微信身份尚未注册，请先创建账号。",
  ACCOUNT_NOTICE_REQUIRED: "请先阅读并同意用户服务协议与账号规范。",
  ACCOUNT_SUSPENDED: "账号已暂停使用，请联系平台处理。",
  AUTH_CONTEXT_MISSING: "暂时无法确认微信身份，请重新打开小程序。",
  AUTH_SERVICE_UNAVAILABLE: "登录服务暂不可用，请稍后再来。",
  CLOUD_UNAVAILABLE: "当前版本未连接云服务，暂时不能登录。",
  INVALID_NICKNAME: "昵称需为 1 至 12 个字符。",
  ACCOUNT_LINK_CONFLICT: "当前微信身份已绑定其他账号，请联系平台处理。",
  ACCOUNT_PHONE_ALREADY_BOUND: "当前账号已绑定其他手机号，请直接登录或联系平台处理。",
  PHONE_ALREADY_REGISTERED: "该手机号已注册，请使用手机号登录。",
  PHONE_CODE_MISSING: "未取得手机号授权，请重试。",
  PHONE_IDENTITY_NOT_CONFIGURED: "手机号登录暂不可用，请使用微信身份登录。",
  PHONE_VERIFICATION_FAILED: "暂未完成手机号验证，请重新授权或使用微信身份登录。"
};

Page({
  data: {
    checking: true,
    success: false,
    successTitle: "登录成功",
    mode: "login",
    account: null,
    accountInitial: "我",
    sessionRegistered: false,
    nickname: "",
    username: "",
    usernameError: false,
    nicknameLength: 0,
    acceptedNotice: false,
    canRegister: false,
    fieldError: false,
    noticeError: false,
    processing: false,
    authMethod: "wechat",
    phone: "",
    verificationCode: "",
    sessionCheckFailed: false,
    errorMessage: ""
  },
  onLoad(options = {}) {
    this.setData({ acceptedNotice: false, canRegister: false });
    if (localPreview.isLocal() && options.audit !== "1") {
      wx.switchTab({ url: "/pages/discover/index" });
      return;
    }
    this.auditMode = localPreview.isAudit(options) && options.audit === "1";
    if (this.auditMode) {
      this.loadAuditState(options.state || "register");
      return;
    }
    if (options.signedOut === '1' || wx.getStorageSync('animeMasterSignedOut') === true) {
      this.setData({ checking: false, mode: 'login' });
      return;
    }
    this.checkSession();
  },
  loadAuditState(state) {
    if (state === "loading") return;
    if (state === "success") {
      this.setData({ checking: false, success: true, successTitle: "账号创建成功" });
      return;
    }
    const login = state === "login";
    this.setData({
      checking: false,
      mode: login ? "login" : "register",
      sessionRegistered: login,
      account: login ? { nickname: "桃桃造型师", uid: "AM_7F31A902" } : null,
      accountInitial: login ? "桃" : "我",
      errorMessage: state === "error" ? "网络开小差了，请稍后重试。" : ""
    });
  },
  async checkSession() {
    if (this.data.processing) return;
    this.setData({ checking: true, errorMessage: "", sessionCheckFailed: false });
    try {
      const app = getApp();
      const startup = app && app.sessionReady;
      if (app) app.sessionReady = null;
      const session = await (startup || cloudAuth.getSession());
      if (session.registered) {
        if (app && app.setServerSession) app.setServerSession(session);
        const route = app && app.takePostAuthRoute ? app.takePostAuthRoute() : '/pages/discover/index';
        if (route === '/pages/discover/index') wx.setStorageSync('animeMasterRole', 'buyer');
        wx.reLaunch({ url: route });
        return;
      }
      if (app && app.clearServerSession) app.clearServerSession();
      this.setData({ checking: false, mode: "register", sessionRegistered: false, account: null });
    } catch (error) {
      this.setData({ checking: false, mode: "login", sessionCheckFailed: true, errorMessage: this.messageFor(error) });
    }
  },
  switchMode(event) {
    if (this.data.processing) return;
    this.setData({ mode: event.currentTarget.dataset.mode, acceptedNotice: false, canRegister: false, errorMessage: "", fieldError: false, noticeError: false });
  },
  updateNickname(event) {
    if (this.data.processing) return;
    const nickname = truncateGraphemes(event.detail.value, 12);
    const nicknameLength = graphemes(nickname).length;
    this.setData({
      nickname,
      nicknameLength,
        fieldError: false,
      errorMessage: "",
      canRegister: registrationReady(nickname, this.data.username, this.data.acceptedNotice)
    });
    return nickname;
  },
  updateUsername(event) {
    if (this.data.processing) return;
    this.setData({ username: event.detail.value, usernameError: false, errorMessage: "", canRegister: registrationReady(this.data.nickname, event.detail.value, this.data.acceptedNotice) });
  },
  toggleNotice() {
    if (this.data.processing) return;
    const acceptedNotice = !this.data.acceptedNotice;
    this.setData({
      acceptedNotice,
        noticeError: false,
      errorMessage: "",
      canRegister: registrationReady(this.data.nickname, this.data.username, acceptedNotice)
    });
  },
  showNotice() {
    wx.navigateTo({ url: "/pages/account-notice/index" });
  },
  showPrivacy() {
    if (!wx.openPrivacyContract) {
      this.setData({ errorMessage: ERROR_MESSAGES.PRIVACY_UNAVAILABLE });
      return;
    }
    wx.openPrivacyContract({
      fail: () => this.setData({ errorMessage: "隐私保护指引暂时无法打开，请稍后重试。" })
    });
  },
  requirePrivacy() {
    return new Promise((resolve, reject) => {
      const unavailable = () => reject({ code: "PRIVACY_UNAVAILABLE" });
      if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) return unavailable();
      wx.getPrivacySetting({
        success({ needAuthorization }) {
          if (needAuthorization === false) return resolve();
          if (needAuthorization !== true) return unavailable();
          wx.requirePrivacyAuthorize({
            success: resolve,
            fail: () => reject({ code: "PRIVACY_REQUIRED" })
          });
        },
        fail: unavailable
      });
    });
  },
  validateRegistration() {
    if (!this.data.nickname.trim()) {
      this.setData({ fieldError: true, noticeError: false, errorMessage: "" });
      return false;
    }
    if (!/^[\x21-\x7e]{2,12}$/.test(this.data.username)) {
      this.setData({ usernameError: true, errorMessage: "" });
      return false;
    }
    if (!this.data.acceptedNotice) {
      this.setData({ noticeError: true, errorMessage: "" });
      return false;
    }
    return true;
  },
  chooseMethod(event) {
    if (this.data.processing) return;
    const authMethod = event.currentTarget.dataset.method;
    if (!["wechat", "phone"].includes(authMethod)) return;
    this.setData({ authMethod, errorMessage: "" });
  },
  updatePhone(event) {
    if (this.data.processing) return;
    this.setData({ phone: String(event.detail.value).replace(/[^0-9]/g, "").slice(0, 11), errorMessage: "" });
  },
  updateVerificationCode(event) {
    if (this.data.processing) return;
    this.setData({ verificationCode: String(event.detail.value).replace(/[^0-9]/g, "").slice(0, 6), errorMessage: "" });
  },
  requestSmsCode() {
    if (this.data.processing) return;
    if (!/^1[3-9][0-9]{9}$/.test(this.data.phone)) {
      this.setData({ errorMessage: "请输入正确的中国大陆手机号。" }); return;
    }
    this.setData({ errorMessage: "短信注册暂未开放，请使用微信注册。" });
  },
  submitSms() {
    if (this.data.processing) return;
    if (this.data.mode === "register" && !this.validateRegistration()) return;
    this.requestSmsCode();
  },
  async submitLogin() {
    if (this.data.processing) return;
    if (this.auditMode) return this.finishAudit("登录成功");
    this.setData({ processing: true, errorMessage: "" });
    try {
      const session = await cloudAuth.login();
      this.finish(session, "登录成功");
    } catch (error) {
      this.setData({ processing: false, errorMessage: this.messageFor(error) });
      if (error.code === "ACCOUNT_NOT_REGISTERED") this.setData({ mode: "register", sessionRegistered: false });
    }
  },
  submitRegister() {
    if (this.data.processing) return;
    this.validateRegistration();
  },
  async authorizeRegistrationPhone(event) {
    if (this.data.processing || !this.validateRegistration()) return;
    const code = event.detail && event.detail.code;
    if (!code) { this.setData({ errorMessage: "需要授权微信手机号才能完成注册；你可以重新授权。" }); return; }
    if (this.auditMode) return this.finishAudit("账号创建成功");
    this.setData({ processing: true, errorMessage: "" });
    try {
      await this.requirePrivacy();
      const session = await cloudAuth.phoneRegister(code, this.data.nickname.trim(), this.data.username, true);
      this.finish(session, session.created ? "账号创建成功" : "账号已存在，登录成功", true);
    } catch (error) {
      this.setData({ processing: false, errorMessage: this.messageFor(error) });
    }
  },
  finishAudit(title) {
    this.setData({ success: true, successTitle: title, errorMessage: "" });
  },
  finish(session, title, registration = false) {
    const app = getApp();
    if (registration) {
      wx.setStorageSync("animeMasterRole", "buyer");
      if (app && app.globalData) app.globalData.pendingRoute = "";
    }
    if (app && app.setServerSession) app.setServerSession(session);
    this.setData({ processing: false, success: true, successTitle: title, errorMessage: "" });
    setTimeout(() => wx.reLaunch({ url: registration ? "/pages/discover/index" : (app && app.takePostAuthRoute ? app.takePostAuthRoute() : "/pages/discover/index") }), 350);
  },
  messageFor(error) {
    return ERROR_MESSAGES[error && error.code] || "网络开小差了，请稍后重试。";
  }
});
