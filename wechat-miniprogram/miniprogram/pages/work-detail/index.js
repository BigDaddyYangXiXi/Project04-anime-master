const { allWorks, findProvider } = require("../../data/catalog");
const store = require("../../data/v063-store");
const storefrontPreviewDraft = require("../../data/storefront-preview-draft");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudSavedItems = require("../../services/cloud-saved-items");

Page({
  data: { work: null, followed: false, liked: false, socialPending: false, gallery: [], codeCopied: false, navWorkspace: "buyer", providerPreview: false },

  onLoad(options) {
    this.providerPreview = options.workspace === "provider";
    this.storefrontDraftPreview = this.providerPreview && options.preview === "storefront";
    this.setData({ navWorkspace: this.providerPreview ? "provider" : "buyer", providerPreview: this.providerPreview });
    if (!this.storefrontDraftPreview && options.audit !== "1") {
      this.socialCloudMode = true;
      this.loadCloudWork(options);
      return;
    }
    const migration = store.migrateLegacyMedia();
    if (!migration) {
      this.loadWork(options);
      return;
    }
    migration.catch(() => {}).then(() => this.loadWork(options));
  },

  loadCloudWork(options) {
    Promise.all([cloudCatalog.getWork(options.id), this.socialCloudMode ? cloudSavedItems.listMine() : Promise.resolve({ providerIds: [], workIds: [] })]).then(([{ work }, saved]) => {
      if (!work) {
        wx.showToast({ title: "没有找到作品", icon: "none" });
        return;
      }
      const provider = work.provider || {};
      const mapped = {
        id: work.id,
        code: work.code,
        title: work.title,
        subtitle: work.subtitle,
        price: Number(work.priceFen || 0) / 100,
        description: work.description,
        tone: work.tone || "coral",
        tags: work.tags || [],
        referenceCount: work.referenceCount || 0,
        imagePreviews: work.imageUrls || [],
        imageCount: (work.imageUrls || []).length,
        provider: {
          id: provider.id,
          uid: provider.uid,
          name: provider.nickname,
          city: provider.city || "",
          avatar: provider.avatarUrl || ""
        }
      };
      this.renderWork(mapped, options, saved);
    }).catch(() => wx.showToast({ title: "云端作品读取失败，请重试", icon: "none" }));
  },

  renderWork(work, options, saved = null) {
    const imagePreviews = work.imagePreviews || [];
    const galleryCount = imagePreviews.length || work.imageCount;
    const followedIds = wx.getStorageSync("v063-followed-providers") || [];
    const likedIds = wx.getStorageSync("anime-master-v063-liked-work-ids") || [];
    this.setData({
      work: Object.assign({}, work, {
        priceText: `￥${work.price}`,
        provider: Object.assign({}, work.provider, { initial: work.provider.name.slice(0, 1) })
      }),
      followed: saved ? saved.providerIds.includes(work.provider.id) : options.followed === "1" || followedIds.includes(work.provider.id),
      liked: saved ? saved.workIds.includes(work.id) : likedIds.includes(work.id),
      gallery: Array.from({ length: galleryCount }, (_, index) => ({ src: imagePreviews[index] || "", label: `${index + 1} / ${galleryCount}` }))
    });
  },

  loadWork(options) {
    const currentProvider = findProvider(store.CURRENT_PROVIDER_ID);
    const previewDraft = this.storefrontDraftPreview ? storefrontPreviewDraft.get() : null;
    const currentProfile = previewDraft ? previewDraft.profile : store.getProfile();
    const sourceWorks = previewDraft ? previewDraft.works : store.getWorks();
    const storedWork = sourceWorks.find((item) => item.id === options.id);
    const work = storedWork && currentProvider ? Object.assign({}, storedWork, {
      provider: Object.assign({}, currentProvider, { name: currentProfile.nickname, city: currentProfile.city, avatar: currentProfile.avatar || "" })
    }) : allWorks().find((item) => item.id === options.id);
    if (!work) {
      wx.showToast({ title: "没有找到作品", icon: "none" });
      return;
    }
    this.renderWork(work, options);
  },

  async toggleFollow() {
    if (this.data.socialPending) return;
    const followed = !this.data.followed;
    const providerId = this.data.work.provider.id;
    if (this.socialCloudMode) {
      this.setData({ socialPending: true });
      try { await cloudSavedItems.setSaved("PROVIDER", providerId, followed); this.setData({ followed, socialPending: false }); }
      catch (error) { this.setData({ socialPending: false }); wx.showToast({ title: "关注状态保存失败", icon: "none" }); }
      return;
    }
    const followedIds = wx.getStorageSync("v063-followed-providers") || [];
    const nextIds = followed ? Array.from(new Set([...followedIds, providerId])) : followedIds.filter((id) => id !== providerId);
    wx.setStorageSync("v063-followed-providers", nextIds);
    this.setData({ followed });
  },

  async toggleLike() {
    if (this.data.socialPending) return;
    const liked = !this.data.liked;
    if (this.socialCloudMode) {
      this.setData({ socialPending: true });
      try { await cloudSavedItems.setSaved("WORK", this.data.work.id, liked); this.setData({ liked, socialPending: false }); }
      catch (error) { this.setData({ socialPending: false }); wx.showToast({ title: "喜欢状态保存失败", icon: "none" }); }
      return;
    }
    const likedIds = wx.getStorageSync("anime-master-v063-liked-work-ids") || [];
    const nextIds = liked ? Array.from(new Set(likedIds.concat(this.data.work.id))) : likedIds.filter((id) => id !== this.data.work.id);
    wx.setStorageSync("anime-master-v063-liked-work-ids", nextIds);
    this.setData({ liked });
  },

  copyCode() {
    if (!this.data.work || !this.data.work.code) return;
    wx.setClipboardData({
      data: this.data.work.code,
      success: () => {
        this.setData({ codeCopied: true });
        clearTimeout(this.copyCodeTimer);
        this.copyCodeTimer = setTimeout(() => this.setData({ codeCopied: false }), 1600);
      }
    });
  },

  startBooking() {
    if (this.providerPreview) return wx.showToast({ title: "作品预览中不可发起预约", icon: "none" });
    wx.navigateTo({ url: `/pages/booking/index?providerId=${this.data.work.provider.id}&workId=${this.data.work.id}` });
  },

  openProvider() {
    wx.navigateTo({ url: `/pages/provider-detail/index?id=${this.data.work.provider.id}&source=B02W${this.providerPreview ? "&workspace=provider" : ""}${this.storefrontDraftPreview ? "&preview=storefront" : ""}` });
  },

  onUnload() {
    clearTimeout(this.copyCodeTimer);
  }
});
