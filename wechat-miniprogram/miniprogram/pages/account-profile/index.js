const store = require("../../data/v063-store");
const cloudAccount = require("../../services/cloud-account");
const cloudCatalog = require("../../services/cloud-catalog");
const { truncateGraphemes } = require("../../utils/input-normalization");
function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

Page({
  data: { role: "buyer", draft: { nickname: "", avatar: "" }, initial: "我", accountVersion: 0, avatarAssetId: null, loading: false, loadError: "", saving: false, canSave: false },
  onLoad(options) {
    const role = options.role === "provider" ? "provider" : "buyer";
    this.cloudMode = options.audit !== "1";
    this.pendingAvatar = null; this.originalAvatar = null; this.saved = false;
    if (this.cloudMode) { this.setData({ role }, () => this.loadCloud()); return; }
    const account = store.getAccount(role);
    this.setData({ role, draft: account, initial: (account.nickname || "我").slice(0, 1), canSave: Boolean((account.nickname || "").trim()) });
  },
  async loadCloud() {
    this.setData({ loading: true, loadError: "" });
    try {
      const account = await cloudAccount.getMine();
      this.originalAvatar = { assetId: account.avatarAssetId, fileId: account.avatarFileId };
      this.setData({ draft: { nickname: account.nickname, avatar: account.avatarUrl }, initial: (account.nickname || "我").slice(0, 1), accountVersion: account.version, avatarAssetId: account.avatarAssetId, loading: false, canSave: Boolean((account.nickname || "").trim()) });
    } catch (error) { this.setData({ loading: false, loadError: "个人资料读取失败，请稍后重试。" }); }
  },
  updateNickname(event) {
    const nickname = truncateGraphemes(event.detail.value, 20);
    this.setData({ "draft.nickname": nickname, initial: (nickname || "我").slice(0, 1), canSave: Boolean(nickname.trim()) });
  },
  async chooseAvatar(event) {
    if (this.data.saving) return;
    const tempFilePath = event && event.detail && event.detail.avatarUrl;
    if (!tempFilePath) return;
    const file = { tempFilePath };
    try {
      const info = await new Promise((resolve, reject) => wx.getFileInfo({ filePath: tempFilePath, success: resolve, fail: reject }));
      file.size = Number(info.size) || 0;
      if (file.size > 10 * 1024 * 1024) return wx.showToast({ title: "头像不能超过 10MB", icon: "none" });
      if (this.cloudMode) {
        wx.showLoading({ title: "上传并审核头像" }); this.setData({ saving: true, loadError: "" });
        let uploaded = null;
        try {
          uploaded = await cloudCatalog.uploadImage(file, "AVATAR");
          for (let attempt = 0; attempt < 15; attempt += 1) {
            const status = await cloudCatalog.getImageStatus(uploaded.assetId);
            if (status.status === "READY") break;
            if (["REJECTED", "DELETED"].includes(status.status)) throw new Error("头像未通过安全审核");
            if (attempt === 14) throw new Error("头像仍在安全审核，请稍后重试");
            await wait(1000);
          }
          if (this.pendingAvatar) await cloudCatalog.cancelImage(this.pendingAvatar.assetId, this.pendingAvatar.fileId).catch(() => null);
          this.pendingAvatar = uploaded;
          this.setData({ "draft.avatar": uploaded.preview, avatarAssetId: uploaded.assetId, saving: false });
        } catch (error) { if (uploaded) await cloudCatalog.cancelImage(uploaded.assetId, uploaded.fileId).catch(() => null); this.setData({ saving: false, loadError: error.message || "头像处理失败" }); wx.showToast({ title: this.data.loadError, icon: "none" }); }
        finally { wx.hideLoading(); }
        return;
      }
      wx.saveFile({ tempFilePath: file.tempFilePath, success: ({ savedFilePath }) => this.setData({ "draft.avatar": savedFilePath }), fail: () => wx.showToast({ title: "头像保存失败", icon: "none" }) });
    } catch (error) {
      wx.showToast({ title: "头像读取失败", icon: "none" });
    }
  },
  async save() {
    const nickname = this.data.draft.nickname.trim();
    if (this.data.saving) return;
    if (!nickname) return wx.showToast({ title: "请填写昵称", icon: "none" });
    this.setData({ saving: true });
    if (this.cloudMode) {
      try {
        const account = await cloudAccount.updateMine(this.data.accountVersion, nickname, this.data.avatarAssetId);
        const publicAccount = { id: account.id, uid: account.uid, nickname: account.nickname, avatarAssetId: account.avatarAssetId, status: "ACTIVE", version: account.version };
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.globalData) app.globalData.account = publicAccount;
        wx.setStorageSync("animeMasterServerAccount", publicAccount);
        if (this.originalAvatar && this.originalAvatar.assetId && this.originalAvatar.assetId !== account.avatarAssetId) await cloudCatalog.cancelImage(this.originalAvatar.assetId, this.originalAvatar.fileId).catch(() => null);
        this.pendingAvatar = null; this.saved = true;
        this.setData({ saving: false, accountVersion: account.version });
        wx.showToast({ title: "个人资料已保存", icon: "success" }); setTimeout(() => wx.navigateBack(), 500);
      } catch (error) {
        this.setData({ saving: false, loadError: error.code === "VERSION_CONFLICT" ? "个人资料已在其他页面更新，请返回后重试。" : "个人资料保存失败，请稍后重试。" });
      }
      return;
    }
    store.saveAccount(this.data.role, Object.assign({}, this.data.draft, { nickname }));
    wx.showToast({ title: "个人资料已保存", icon: "success" });
    setTimeout(() => wx.navigateBack(), 500);
  },
  async onUnload() {
    if (this.cloudMode && !this.saved && this.pendingAvatar) await cloudCatalog.cancelImage(this.pendingAvatar.assetId, this.pendingAvatar.fileId).catch(() => null);
    this.pendingAvatar = null;
  }
});
