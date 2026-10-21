const localPreview = require("../../utils/local-preview");
const { allWorks, findProvider } = require("../../data/catalog");
const store = require("../../data/v063-store");
const storefrontPreviewDraft = require("../../data/storefront-preview-draft");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudSavedItems = require("../../services/cloud-saved-items");

Page({
  data: {
    work: null, socialLoadError: "", followed: false, liked: false, socialPending: false, gallery: [], codeCopied: false, navWorkspace: "buyer", providerPreview: false },

  onLoad(options) {
    this.unloaded = false;
    const requestId = this.workRequestId = (this.workRequestId || 0) + 1;
    this.workOptions = options;
    this.setData({ loading: true, loadError: "", socialLoadError: "", socialPending: false });
    this.providerPreview = options.workspace === "provider";
    this.storefrontDraftPreview = this.providerPreview && options.preview === "storefront";
    this.setData({ navWorkspace: this.providerPreview ? "provider" : "buyer", providerPreview: this.providerPreview });
    if (this.storefrontDraftPreview && !localPreview.isAudit(options)) {
      const draft = storefrontPreviewDraft.get();
      const owner = typeof getApp === 'function' ? getApp().globalData.account?.id : null;
      if (draft && String(draft.providerId) === String(owner) && (!options.providerId || String(draft.providerId) === String(options.providerId)) && (draft.works || []).some(work => work.id === options.id)) {
        this.loadWork(options);
        return;
      }
      this.storefrontDraftPreview = false;
    }
    if (!this.storefrontDraftPreview && !localPreview.isAudit(options)) {
      this.socialCloudMode = true;
      this.loadCloudWork(options);
      return;
    }
    const migration = store.migrateLegacyMedia();
    if (!migration) {
      this.loadWork(options);
      return;
    }
    migration.catch(() => {}).then(() => { if (requestId === this.workRequestId) this.loadWork(options); });
  },

  loadCloudWork(options) {
    const requestId = this.workRequestId = (this.workRequestId || 0) + 1;
    return Promise.all([cloudCatalog.getWork(options.id, options.providerId), this.socialCloudMode && !this.providerPreview ? cloudSavedItems.listMine().catch(() => null) : Promise.resolve({ providerIds: [], workIds: [] })]).then(([{ work }, saved]) => {
      if (requestId !== this.workRequestId) return;
      if (!work) {
        this.setData({ loading: false, loadError: "这件作品暂时无法查看" });
        return;
      }
      const provider = work.provider || {};
      const mapped = {
        id: work.id,
        code: work.code,
        title: work.title,
        subtitle: work.subtitle,
        creditCoser: work.creditCoser || "",
        creditPhoto: work.creditPhoto || "",
        creditMakeup: work.creditMakeup || "",
        creditRetouch: work.creditRetouch || "",
        creditMine: work.creditMine || "",

        price: work.priceFen == null ? null : Number(work.priceFen) / 100,
        description: work.description,
        tone: work.tone || "coral",
        tags: work.tags || [],
        referenceCount: work.referenceCount || 0,
        service: work.service || (provider.services || []).find((item) => item.id === work.serviceId) || null,
        imagePreviews: work.imageUrls || [],
        imageCount: (work.imageUrls || []).length,
        provider: {
          id: provider.id,
          uid: provider.uid,
          name: provider.nickname,
          city: provider.city || "",
          career: provider.career || "",
          avatar: provider.avatarUrl || ""
        }
      };
      this.renderWork(mapped, options, saved || { providerIds: [], workIds: [] });
      this.setData({ socialLoadError: saved ? "" : "关注和喜欢状态读取失败，可重新同步。" });
    }).catch(() => { if (requestId === this.workRequestId) this.setData({ loading: false, loadError: "作品未能加载，请重试" }); });
  },

  retryLoad() { this.onLoad(this.workOptions); },

  async retrySocial() {
    if (this.unloaded || this.data.socialPending || !this.data.socialLoadError || !this.data.work) return;
    const requestId = this.workRequestId;
    this.setData({ socialPending: true });
    try {
      const saved = await cloudSavedItems.listMine();
      if (requestId !== this.workRequestId) return;
      this.setData({ followed: saved.providerIds.includes(this.data.work.provider.id), liked: saved.workIds.includes(this.data.work.id), socialLoadError: "" });
    } catch { /* Keep the visible error and allow another retry. */ }
    finally { if (requestId === this.workRequestId) this.setData({ socialPending: false }); }
  },

  renderWork(work, options, saved = null) {
    const service = work.service;
    const imagePreviews = work.imagePreviews || [];
    const galleryCount = imagePreviews.length || work.imageCount;
    const followedIds = wx.getStorageSync("v063-followed-providers") || [];
    const likedIds = wx.getStorageSync("anime-master-v063-liked-work-ids") || [];
    this.setData({
      loading: false, loadError: "",
      relatedService: service ? Object.assign({}, service, { priceText: `￥${service.priceFen != null ? Number(service.priceFen) / 100 : service.price}` }) : null,
      work: Object.assign({}, work, {
        priceText: work.price == null ? "未填写参考价" : `￥${work.price}`,
        provider: Object.assign({}, work.provider, { initial: work.provider.name.slice(0, 1) })
      }),
      followed: saved ? saved.providerIds.includes(work.provider.id) : options.followed === "1" || followedIds.includes(work.provider.id),
      liked: saved ? saved.workIds.includes(work.id) : likedIds.includes(work.id),
      gallery: Array.from({ length: galleryCount }, (_, index) => ({ src: imagePreviews[index] || "" }))
    });
  },

  loadWork(options) {
    const previewDraft = this.storefrontDraftPreview ? storefrontPreviewDraft.get() : null;
    const currentProvider = previewDraft ? { id: previewDraft.providerId, uid: previewDraft.profile.uid || "",
      name: previewDraft.profile.nickname || "", city: previewDraft.profile.city || "",
      avatar: previewDraft.profile.avatar || "", career: previewDraft.profile.career || "" } : findProvider(store.CURRENT_PROVIDER_ID);
    const currentProfile = previewDraft ? previewDraft.profile : store.getProfile();
    const sourceWorks = previewDraft ? previewDraft.works : store.getWorks();
    const storedWork = sourceWorks.find((item) => item.id === options.id);
    const work = storedWork && currentProvider ? Object.assign({}, storedWork, {
      provider: Object.assign({}, currentProvider, { name: currentProfile.nickname, city: currentProfile.city, avatar: currentProfile.avatar || "" })
    }) : previewDraft ? null : allWorks().find((item) => item.id === options.id);
    if (!work) {
      this.setData({ loading: false, loadError: "这件作品暂时无法查看" });
      return;
    }
    const services = storedWork ? (previewDraft ? previewDraft.services : store.getServices()) : work.provider.services || [];
    work.service = services.find((service) => (service.workIds || []).includes(work.id) || service.id === work.serviceId) || null;
    this.renderWork(work, options);
  },

  async toggleFollow() {
    if (this.data.socialPending || this.data.socialLoadError || this.providerPreview || !this.data.work) return;
    const followed = !this.data.followed;
    const providerId = this.data.work.provider.id;
    if (this.socialCloudMode) {
      const requestId = this.workRequestId;
      this.setData({ socialPending: true });
      try { await cloudSavedItems.setSaved("PROVIDER", providerId, followed); if (requestId === this.workRequestId) this.setData({ followed, socialPending: false }); }
      catch (error) { if (requestId === this.workRequestId) { this.setData({ socialPending: false }); wx.showToast({ title: "关注状态保存失败", icon: "none" }); } }
      return;
    }
    const followedIds = wx.getStorageSync("v063-followed-providers") || [];
    const nextIds = followed ? Array.from(new Set([...followedIds, providerId])) : followedIds.filter((id) => id !== providerId);
    wx.setStorageSync("v063-followed-providers", nextIds);
    this.setData({ followed });
  },

  async toggleLike() {
    if (this.data.socialPending || this.data.socialLoadError || this.providerPreview || !this.data.work) return;
    const liked = !this.data.liked;
    if (this.socialCloudMode) {
      const requestId = this.workRequestId;
      this.setData({ socialPending: true });
      try { await cloudSavedItems.setSaved("WORK", this.data.work.id, liked); if (requestId === this.workRequestId) this.setData({ liked, socialPending: false }); }
      catch (error) { if (requestId === this.workRequestId) { this.setData({ socialPending: false }); wx.showToast({ title: "喜欢状态保存失败", icon: "none" }); } }
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
    const service = this.data.relatedService;
    wx.navigateTo({ url: `/pages/booking/index?providerId=${this.data.work.provider.id}&workId=${this.data.work.id}${service ? `&services=${encodeURIComponent(service.id)}` : ""}` });
  },

  previewGallery(event) {
    const urls=this.data.gallery.map(image=>image.src).filter(Boolean),index=Number(event.currentTarget.dataset.index||0);
    if(urls.length)wx.previewImage({current:urls[index]||urls[0],urls});
  },
  openRelatedService() {
    if(!this.data.relatedService)return;
    wx.navigateTo({url:`/pages/provider-detail/index?id=${this.data.work.provider.id}&expanded=${encodeURIComponent(this.data.relatedService.id)}${this.providerPreview?'&workspace=provider':''}${this.storefrontDraftPreview?'&preview=storefront':''}`});
  },
  openProvider() {
    wx.navigateTo({ url: `/pages/provider-detail/index?id=${this.data.work.provider.id}&source=B02W${this.providerPreview ? "&workspace=provider" : ""}${this.storefrontDraftPreview ? "&preview=storefront" : ""}` });
  },

  onUnload() {
    this.unloaded = true;
    this.workRequestId = (this.workRequestId || 0) + 1;
    clearTimeout(this.copyCodeTimer);
  }
});
