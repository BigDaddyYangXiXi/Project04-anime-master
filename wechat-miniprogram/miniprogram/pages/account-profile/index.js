const localPreview = require("../../utils/local-preview");
const store = require("../../data/v063-store");
const cloudAccount = require("../../services/cloud-account");
const cloudCatalog = require("../../services/cloud-catalog");
const imagePerformance = require("../../utils/image-performance");
const { graphemes, truncateGraphemes } = require("../../utils/input-normalization");
const AVATAR_DRAFT_KEY = "animeMasterPendingAvatarV1";
const ownerId = () => getApp().globalData.account?.id;

Page({
  data: { avatarBusy: false, avatarState: "", avatarMessage: "", deferredAvatar: false, nicknameLength: 0, role: "buyer", draft: { nickname: "", avatar: "" }, initial: "我", accountVersion: 0, avatarAssetId: null, loading: false, loadError: "", saving: false, canSave: false },
  onLoad(options) {
    this.closed = false;
    const role = options.role === "provider" ? "provider" : "buyer";
    this.cloudMode = !localPreview.isAudit(options);
    this.pendingAvatar = null; this.originalAvatar = null; this.saved = false;
    if (this.cloudMode) { this.setData({ role }, () => this.loadCloud()); return; }
    const account = store.getAccount(role);
    this.initialNickname = account.nickname || '';
    this.setData({ nicknameLength: graphemes(account.nickname || "").length, role, draft: account, initial: (account.nickname || "我").slice(0, 1), canSave: Boolean((account.nickname || "").trim()) });
  },
  async loadCloud() {
    if (this.closed) return;
    const owner = ownerId();
    this.setData({ loading: true, loadError: "" });
    try {
      const account = await cloudAccount.getMine({ force: true });
      if (this.closed || owner !== ownerId()) return;
      this.setData({ deferredAvatar: Boolean(account.deferredAvatar) });
      this.originalAvatar = { assetId: account.avatarAssetId, fileId: account.avatarFileId };
      this.initialNickname = account.nickname || '';
      this.setData({ nicknameLength: graphemes(account.nickname || "").length, draft: { nickname: account.nickname, avatar: account.avatarUrl }, initial: (account.nickname || "我").slice(0, 1), accountVersion: account.version, avatarAssetId: account.avatarAssetId, loading: false, canSave: Boolean((account.nickname || "").trim()) });
      this.restoreAvatarDraft(owner, account);
    } catch (error) { if (!this.closed && owner === ownerId()) this.setData({ loading: false, loadError: "个人资料读取失败，请稍后重试。" }); }
  },
  updateNickname(event) {
    const nickname = truncateGraphemes(event.detail.value, 12);
    this.setData({ nicknameLength: graphemes(nickname).length, "draft.nickname": nickname, initial: (nickname || "我").slice(0, 1), canSave: Boolean(nickname.trim()) });
    return nickname;
  },
  back() {
    if (this.closed || this.data.saving || this.data.avatarBusy) return;
    if (this.data.draft.nickname === this.initialNickname && !this.pendingAvatar) return wx.navigateBack();
    const owner = ownerId();
    wx.showActionSheet({ itemList: ['保存账号资料并返回', '继续编辑', '不保存并返回'], success: ({ tapIndex }) => {
      if (this.closed || this.data.saving || this.data.avatarBusy || owner !== ownerId()) return;
      if (tapIndex === 0) this.save();
      else if (tapIndex === 2) wx.navigateBack();
    } });
  },
  rememberAvatarDraft(owner) {
    if (!this.pendingAvatar || owner !== ownerId()) return;
    try { wx.setStorageSync(AVATAR_DRAFT_KEY, { owner, at: Date.now(), assetId: this.pendingAvatar.assetId, fileId: this.pendingAvatar.fileId }); } catch (_) { /* Cloud asset remains recoverable; storage is optional. */ }
  },
  restoreAvatarDraft(owner, account) {
    let task;
    try { task = wx.getStorageSync(AVATAR_DRAFT_KEY); } catch (_) { /* Server task can still recover. */ }
    if (account.contentIntent?.assetId && ["STAGED", "PENDING"].includes(account.contentIntent.status)) task = { ...(task?.owner === owner && task?.assetId === account.contentIntent.assetId ? task : {}), owner, assetId: account.contentIntent.assetId, at: Date.now(), submitted: true };
    if (!task || task.owner !== owner || Date.now() - task.at > 86400000 || Date.now() < task.at) return;
    if (account.avatarAssetId === task.assetId) { try { wx.removeStorageSync(AVATAR_DRAFT_KEY); } catch (_) {} return; }
    this.pendingAvatar = task;
    if (task.fileId && wx.cloud?.getTempFileURL) wx.cloud.getTempFileURL({ fileList: [task.fileId] }).then(result => {
      const file = result.fileList?.[0];
      if (!this.closed && owner === ownerId() && this.pendingAvatar?.assetId === task.assetId && !file?.status && file?.tempFileURL) this.setData({ "draft.avatar": file.tempFileURL });
    }).catch(() => null);
    this.setData({ avatarState: "reviewing", avatarMessage: ["PENDING", "STAGED"].includes(account.contentIntent?.status) ? "头像更新已提交，检测通过后生效。" : "上次上传的头像尚未保存，正在核对检测结果。" });
    this.reviewStarted = Date.now(); this.reviewAttempts = 0;
    this.checkAvatar();
  },
  async chooseAvatar(event) {
    if (this.data.saving || this.data.avatarBusy || this.closed) return;
    const owner = this.cloudMode ? ownerId() : null;
    const current = () => !this.closed && (!this.cloudMode || owner === ownerId());
    const tempFilePath = event?.detail?.avatarUrl;
    if (!tempFilePath) return;
    const previous = this.data.draft.avatar;
    clearTimeout(this.avatarTimer); this.pendingAvatar = null;
    this.setData({ "draft.avatar": tempFilePath, avatarBusy: true, avatarState: "uploading", avatarMessage: "正在上传头像，可继续编辑昵称；上传完成前请保留此页。", loadError: "" });
    try {
      const info = await new Promise((resolve, reject) => wx.getFileInfo({ filePath: tempFilePath, success: resolve, fail: reject }));
      if (!current()) return;
      if (Number(info.size) > 10 * 1024 * 1024) throw Error("头像不能超过 10MB");
      if (!this.cloudMode) {
        this.setData({ avatarState: "ready", avatarMessage: "预览已更新，保存后生效。" }); return;
      }
      const uploaded = await cloudCatalog.uploadImage({ tempFilePath, size: Number(info.size) || 0 }, "AVATAR");
      // A completed upload is kept even if the page closes; never cancel a delayed check.
      if (owner !== ownerId()) return;
      if (!current()) {
        try { wx.setStorageSync(AVATAR_DRAFT_KEY, { owner, at: Date.now(), assetId: uploaded.assetId, fileId: uploaded.fileId }); } catch (_) {}
        return;
      }
      this.pendingAvatar = uploaded; this.rememberAvatarDraft(owner);
      this.setData({ avatarState: "reviewing", avatarMessage: "头像检测中，可继续编辑昵称。" });
      this.reviewStarted = Date.now(); this.reviewAttempts = 0;
      this.checkAvatar();
    } catch (error) {
      if (error.recoverableUpload && current()) {
        this.pendingAvatar = error.recoverableUpload; this.rememberAvatarDraft(owner);
        this.setData({ avatarState: "reviewing", avatarMessage: "检测结果暂未确认，已保留本次上传，可继续编辑。" });
        this.reviewStarted = Date.now(); this.reviewAttempts = 0; this.checkAvatar(); return;
      }
      if (current()) this.setData({ "draft.avatar": previous, avatarState: "error", avatarMessage: "头像上传未完成，请重新选择。", loadError: error.message || "头像上传失败" });
    } finally { if (current()) this.setData({ avatarBusy: false }); }
  },
  async checkAvatar() {
    if (this.closed || this.hidden || !this.pendingAvatar || this.reviewPending) return;
    const owner = ownerId(), assetId = this.pendingAvatar.assetId;
    this.reviewPending = true;
    try {
      const result = await cloudCatalog.getImageStatus(assetId);
      if (this.closed || owner !== ownerId() || this.pendingAvatar?.assetId !== assetId) return;
      if (result.status === "READY") {
        if (this.pendingAvatar.submitted) {
          const account = await cloudAccount.getMine({ force: true });
          if (this.closed || owner !== ownerId() || this.pendingAvatar?.assetId !== assetId) return;
          if (account.avatarAssetId === assetId) {
            this.pendingAvatar = null;
            this.setData({ avatarAssetId: assetId, accountVersion: account.version, "draft.avatar": account.avatarUrl || this.data.draft.avatar, avatarState: "ready", avatarMessage: "头像已更新并生效。" }); return;
          }
          this.setData({ avatarMessage: "头像检测通过，已提交的更新任务正在完成。" });
        } else {
        this.setData({ avatarAssetId: assetId, avatarState: "ready", avatarMessage: "头像检测通过，保存后生效。" }); return;
        }
      }
      if (["REJECTED", "DELETED"].includes(result.status)) {
        this.setData({ avatarState: "rejected", avatarMessage: "头像未通过检测，请更换图片；当前公开头像保持不变。" }); return;
      }
    } catch (_) {
      if (this.closed || owner !== ownerId()) return;
      this.setData({ avatarMessage: "暂未取得检测结果，上传记录已保留。" });
    } finally { this.reviewPending = false; }
    if (this.closed || this.hidden || owner !== ownerId()) return;
    const attempt = this.reviewAttempts = (this.reviewAttempts || 0) + 1;
    if (attempt >= 8 || Date.now() - this.reviewStarted >= 30000) {
      this.setData({ avatarMessage: "检测耗时较长，已保留上传记录。可先保存昵称，稍后返回核对。" }); return;
    }
    this.avatarTimer = setTimeout(() => this.checkAvatar(), [1000, 2000, 3000, 5000][Math.min(attempt - 1, 3)]);
  },
  onHide() { this.hidden = true; clearTimeout(this.avatarTimer); },
  onShow() {
    this.hidden = false;
    if (this.pendingAvatar) { this.reviewStarted = Date.now(); this.reviewAttempts = 0; this.checkAvatar(); }
  },
  async save() {
    if (this.closed) return;
    const nickname = this.data.draft.nickname.trim();
    if (this.data.saving || this.data.loading) return;
    if (!nickname) return wx.showToast({ title: "请填写昵称", icon: "none" });
    this.setData({ saving: true });
    if (this.cloudMode) {
      const owner = ownerId();
      try {
        const waiting = this.data.avatarState === "reviewing" && this.pendingAvatar;
        const requestedAvatar = waiting && this.data.deferredAvatar ? waiting.assetId : this.data.avatarAssetId;
        const account = await imagePerformance.measure("profileSave", () => cloudAccount.updateMine(this.data.accountVersion, nickname, requestedAvatar, Boolean(waiting && this.data.deferredAvatar)));
        if (this.closed || owner !== ownerId()) return;
        this.initialNickname = account.nickname;
        const publicAccount = { id: account.id, uid: account.uid, nickname: account.nickname, avatarAssetId: account.avatarAssetId, status: "ACTIVE", version: account.version };
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.globalData) app.globalData.account = publicAccount;
        try { wx.setStorageSync("animeMasterServerAccount", publicAccount); } catch (_) { /* Optional display copy must not reject a confirmed server result. */ }
        const waitingForAvatar = this.data.avatarBusy || this.data.avatarState === "reviewing" || (this.pendingAvatar && this.pendingAvatar.assetId !== account.avatarAssetId);
        if (waitingForAvatar && !account.contentIntent) {
          this.setData({ saving: false, accountVersion: account.version, avatarMessage: "昵称已保存；头像尚未保存，检测通过后请再次保存。" });
          wx.showToast({ title: "昵称已保存", icon: "success" }); return;
        }
        if (!account.contentIntent) { try { wx.removeStorageSync(AVATAR_DRAFT_KEY); } catch (_) {} }
        this.pendingAvatar = null; this.saved = true;
        this.setData({ saving: false, accountVersion: account.version });
        wx.showToast({ title: account.contentIntent ? "已提交，头像检测后生效" : "个人资料已保存", icon: account.contentIntent ? "none" : "success" }); wx.navigateBack();
      } catch (error) {
        if (this.closed || owner !== ownerId()) return;
        const nicknameErrors = { NICKNAME_TAKEN: "这个昵称已被使用，请换一个。", NICKNAME_REJECTED: "昵称含不适宜内容，请修改后重试。", NICKNAME_REVIEW_REQUIRED: "昵称暂未通过审核，请修改后重试。", NICKNAME_CHECK_UNAVAILABLE: "暂时无法校验昵称，请稍后重试。" };
        this.setData({ saving: false, loadError: nicknameErrors[error.code] || (error.code === "VERSION_CONFLICT" ? "个人资料已在其他页面更新，请返回后重试。" : "个人资料保存失败，请稍后重试。") });
      }
      return;
    }
    store.saveAccount(this.data.role, Object.assign({}, this.data.draft, { nickname }));
    wx.showToast({ title: "个人资料已保存", icon: "success" });
    setTimeout(() => wx.navigateBack(), 500);
  },
  async onUnload() {
    this.closed = true;
    clearTimeout(this.avatarTimer);
    this.pendingAvatar = null;
  }
});
