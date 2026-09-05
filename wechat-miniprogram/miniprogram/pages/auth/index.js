const cloudAuth = require("../../services/cloud-auth");
const { graphemes, truncateGraphemes } = require("../../utils/input-normalization");

const ERROR_MESSAGES = {
  ACCOUNT_CLOSED: "账号已注销，无法登录。",
  ACCOUNT_NOT_REGISTERED: "当前微信身份尚未注册，请先创建账号。",
  ACCOUNT_NOTICE_REQUIRED: "请先确认账号标识和昵称用途。",
  ACCOUNT_SUSPENDED: "账号已暂停使用，请联系平台处理。",
  AUTH_CONTEXT_MISSING: "暂时无法确认微信身份，请重新打开小程序。",
  CLOUD_UNAVAILABLE: "当前版本未连接云服务，暂时不能登录。",
  INVALID_NICKNAME: "昵称需为 1 至 20 个字符。",
  ACCOUNT_LINK_CONFLICT: "当前微信身份已绑定其他账号，请联系平台处理。",
  ACCOUNT_PHONE_ALREADY_BOUND: "当前账号已绑定其他手机号，请直接登录或联系平台处理。",
  PHONE_ALREADY_REGISTERED: "该手机号已注册，请切换到手机号登录。",
  PHONE_CODE_MISSING: "未取得手机号授权，请重试。",
  PHONE_IDENTITY_NOT_CONFIGURED: "手机号登录暂未完成服务配置。",
  PHONE_VERIFICATION_FAILED: "微信未能验证手机号，请重试。"
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
    nicknameLength: 0,
    acceptedNotice: false,
    canRegister: false,
    fieldError: false,
    noticeError: false,
    processing: false,
    errorMessage: ""
  },
  onLoad(options) {
    this.auditMode = options.audit === "1";
    if (this.auditMode) {
      this.loadAuditState(options.state || "register");
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
    this.setData({ checking: true, errorMessage: "" });
    try {
      const session = await cloudAuth.getSession();
      if (session.registered) {
        this.setData({
          checking: false,
          mode: "login",
          sessionRegistered: true,
          account: session.account,
          accountInitial: (session.account.nickname || "我").slice(0, 1)
        });
        return;
      }
      const app = getApp();
      if (app && app.clearServerSession) app.clearServerSession();
      this.setData({ checking: false, mode: "register", sessionRegistered: false });
    } catch (error) {
      this.setData({ checking: false, mode: "login", errorMessage: this.messageFor(error) });
    }
  },
  switchMode(event) {
    if (this.data.processing) return;
    this.setData({ mode: event.currentTarget.dataset.mode, errorMessage: "", fieldError: false, noticeError: false });
  },
  updateNickname(event) {
    const nickname = truncateGraphemes(event.detail.value, 20);
    const nicknameLength = graphemes(nickname).length;
    this.setData({
      nickname,
      nicknameLength,
      fieldError: false,
      errorMessage: "",
      canRegister: Boolean(nickname.trim() && this.data.acceptedNotice)
    });
  },
  toggleNotice() {
    if (this.data.processing) return;
    const acceptedNotice = !this.data.acceptedNotice;
    this.setData({
      acceptedNotice,
      noticeError: false,
      errorMessage: "",
      canRegister: Boolean(this.data.nickname.trim() && acceptedNotice)
    });
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
  async submitRegister() {
    if (this.data.processing) return;
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      this.setData({ fieldError: true, noticeError: false, errorMessage: "" });
      return;
    }
    if (!this.data.acceptedNotice) {
      this.setData({ noticeError: true, errorMessage: "" });
      return;
    }
    if (this.auditMode) return this.finishAudit("账号创建成功");
    this.setData({ processing: true, errorMessage: "" });
    try {
      const session = await cloudAuth.register(nickname, true);
      this.finish(session, session.created ? "账号创建成功" : "账号已存在，登录成功");
    } catch (error) {
      this.setData({ processing: false, errorMessage: this.messageFor(error) });
    }
  },
  async submitPhone(event) {
    if (this.data.processing) return;
    const code = event && event.detail && event.detail.code;
    if (!code) {
      this.setData({ errorMessage: "你没有同意手机号授权，可选择微信身份继续。" });
      return;
    }
    if (this.data.mode === "register") {
      const nickname = this.data.nickname.trim();
      if (!nickname) return this.setData({ fieldError: true, noticeError: false, errorMessage: "" });
      if (!this.data.acceptedNotice) return this.setData({ noticeError: true, errorMessage: "" });
    }
    if (this.auditMode) return this.finishAudit(this.data.mode === "register" ? "账号创建成功" : "登录成功");
    this.setData({ processing: true, errorMessage: "" });
    try {
      const session = this.data.mode === "register"
        ? await cloudAuth.phoneRegister(code, this.data.nickname.trim(), true)
        : await cloudAuth.phoneLogin(code);
      this.finish(session, session.created ? "账号创建成功" : "登录成功");
    } catch (error) {
      const changes = { processing: false, errorMessage: this.messageFor(error) };
      if (error.code === "ACCOUNT_NOT_REGISTERED") changes.mode = "register";
      this.setData(changes);
    }
  },
  finishAudit(title) {
    this.setData({ success: true, successTitle: title, errorMessage: "" });
  },
  finish(session, title) {
    const app = getApp();
    if (app && app.setServerSession) app.setServerSession(session);
    this.setData({ processing: false, success: true, successTitle: title, errorMessage: "" });
    setTimeout(() => wx.reLaunch({ url: app && app.takePostAuthRoute ? app.takePostAuthRoute() : "/pages/discover/index" }), 350);
  },
  messageFor(error) {
    return ERROR_MESSAGES[error && error.code] || "网络开小差了，请稍后重试。";
  }
});
