const localPreview = require("../../utils/local-preview");
const { chooseImageMedia } = require("../../utils/work-media-picker");
const projectModel = require("../../data/project-model");
const cloudProjects = require("../../services/cloud-projects");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudAccount = require("../../services/cloud-account");
const projectImagePreview = require("../../utils/project-image-preview");
const { pickerRegion } = require("../../utils/discovery-region");
const { setDiscoveryContext } = require("../../data/discovery-context");
const MAX_TARGET_IMAGES = 6;
const FIELD_LABELS = [["projectName", "项目名称"], ["date", "日期"], ["city", "城市"], ["location", "地点"], ["description", "项目描述"]];

function validation(fields) {
  const missing = FIELD_LABELS.filter(([key]) => key === "city"
    ? !String(fields.city || "").trim() || !/^\d{6}$/.test(String(fields.cityCode || ""))
    : !String(fields[key] || "").trim()).map(([, label]) => label);
  return { canSave: missing.length === 0, saveError: missing.length ? `还需填写：${missing.join("、")}` : "" };
}
function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

Page({
  data: {
    project: null, sourceCount: 0, projectName: "", date: "", city: "", cityCode: "", location: "", description: "",
    targetImages: [], targetAssets: [], targetImageRows: [], canSave: false, saveError: "", loading: false, loadError: "", actionPending: false, processingImages: false
  },
  onLoad(options) {
    this.unloaded = false;
    this.pendingSavedFiles = []; this.removedSavedFiles = []; this.pendingCloudAssets = []; this.removedCloudAssets = [];
    this.projectId = options.id; this.cloudMode = !localPreview.isAudit(options);
    this.load();
  },
  async load() {
    if (this.unloaded) return;
    if (this.cloudMode) {
      const request = this.loadSequence = (this.loadSequence || 0) + 1;
      const projectId = this.projectId, owner = getApp().globalData.account?.id;
      const current = () => !this.unloaded && this.loadSequence === request && this.projectId === projectId && owner === getApp().globalData.account?.id;
      this.setData({ loading: true, loadError: "" });
      try {
        const project = await cloudProjects.getProject(projectId);
        if (!current()) return;
        this.renderProject(project);
        this.setData({ loading: false });
      } catch (error) {
        if (!current()) return;
        this.setData({ loading: false, loadError: error && error.code === "PROJECT_NOT_FOUND" ? "没有找到这个项目。" : "项目读取失败，请稍后重试。" });
      }
      return;
    }
    let project = projectModel.getProjects().find((item) => item.id === this.projectId);
    if (!project) { project = projectModel.deriveProjectDraft(this.projectId); projectModel.upsertProject(project); }
    this.renderProject(project);
  },
  renderProject(project) {
    const assets = project.targetImageAssets || (project.targetImages || []).map((fileId) => ({ assetId: "", fileId, preview: fileId, status: "READY" }));
    const fields = {
      projectName: project.shortTitle || project.title || "", date: project.date || "", city: project.city || "", cityCode: project.cityCode || "",
      location: project.location || "", description: project.description || project.brief && project.brief.description || "",
      targetAssets: assets.slice(0, MAX_TARGET_IMAGES), targetImages: assets.map((item) => item.preview == null ? item.fileId : item.preview).slice(0, MAX_TARGET_IMAGES)
    };
    fields.targetImageRows = projectImagePreview.rows(fields.targetImages, fields.targetAssets);
    this.setData(Object.assign({ project, sourceCount: Array.isArray(project.sourceOrderIds) ? project.sourceOrderIds.length : 0 }, fields, validation(fields)));
  },
  updateField(key, value) { const next = { [key]: value }; this.setData(Object.assign(next, validation(Object.assign({}, this.data, next)))); },
  updateProjectName(event) { this.updateField("projectName", event.detail.value); },
  updateDate(event) { this.updateField("date", event.detail.value); },
  updateCity(event) {
    const region = pickerRegion(event.detail);
    if (!region) return wx.showToast({ title: "城市信息读取失败，请重试", icon: "none" });
    const next = { city: region.cityName, cityCode: region.cityCode };
    this.setData(Object.assign(next, validation(Object.assign({}, this.data, next))));
  },
  updateLocation(event) { this.updateField("location", event.detail.value); },
  updateDescription(event) { this.updateField("description", event.detail.value); },
  saveTargetFile(file) {
    if (file.size && file.size > 20 * 1024 * 1024) return Promise.reject(new Error("单张图片不能超过 20MB"));
    return new Promise((resolve, reject) => wx.saveFile({ tempFilePath: file.tempFilePath, success: ({ savedFilePath }) => { this.pendingSavedFiles.push(savedFilePath); resolve(savedFilePath); }, fail: reject }));
  },
  async waitForCloudImage(asset, current = () => !this.unloaded) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if (!current()) throw new Error("PAGE_CHANGED");
      const status = await cloudCatalog.getImageStatus(asset.assetId);
      if (!current()) throw new Error("PAGE_CHANGED");
      if (status.status === "READY") return { ...asset, status: "READY" };
      if (["REJECTED", "DELETED"].includes(status.status)) throw new Error("图片未通过安全审核");
      await wait(1000);
    }
    throw new Error("图片仍在安全审核，请稍后重新添加");
  },
  chooseTargetImages() {
    if (this.unloaded) return;
    const owner = this.cloudMode ? getApp().globalData.account?.id : null, projectId = this.projectId;
    const current = () => !this.unloaded && this.projectId === projectId && (!this.cloudMode || owner === getApp().globalData.account?.id);
    const remaining = MAX_TARGET_IMAGES - this.data.targetImages.length;
    if (remaining <= 0 || this.data.actionPending) return wx.showToast({ title: `最多添加 ${MAX_TARGET_IMAGES} 张图片`, icon: "none" });
    chooseImageMedia({ count: remaining, sizeType: ["compressed"], success: async ({ tempFiles }) => {
      if (!current() || this.data.actionPending) return;
      wx.showLoading({ title: this.cloudMode ? "上传并审核图片" : "正在保存图片" });
      this.setData({ actionPending: true, processingImages: true });
      const added = [];
      try {
        for (const file of (tempFiles || []).slice(0, remaining)) {
          if (!current()) return;
          if (this.cloudMode) {
            const uploaded = await cloudCatalog.uploadImage(file, "PROJECT_TARGET");
            if (!current()) {
              if (owner === getApp().globalData.account?.id) await cloudCatalog.cancelImage(uploaded.assetId, uploaded.fileId).catch(() => null);
              return;
            }
            this.pendingCloudAssets.push(uploaded);
            added.push({ ...await this.waitForCloudImage(uploaded, current), preview: file.tempFilePath });
          } else added.push({ assetId: "", fileId: await this.saveTargetFile(file), preview: this.pendingSavedFiles[this.pendingSavedFiles.length - 1], status: "READY" });
        }
        if (!current()) return;
        const targetAssets = this.data.targetAssets.concat(added).slice(0, MAX_TARGET_IMAGES);
        this.updateTargetAssets(targetAssets);
        this.setData({ actionPending: false, processingImages: false });
      } catch (error) {
        if (!current()) return;
        for (const asset of added) if (asset.assetId) await cloudCatalog.cancelImage(asset.assetId, asset.fileId).catch(() => null);
        this.setData({ actionPending: false, processingImages: false }); wx.showToast({ title: error.message || "图片处理失败", icon: "none" });
      } finally { wx.hideLoading(); }
    } });
  },
  removeTargetImage(event) {
    if (this.unloaded || this.data.actionPending) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!this.cloudMode) {
      const filePath = this.data.targetImages[index]; if (!this.data.targetAssets[index]) return;
      if (this.pendingSavedFiles.includes(filePath)) { this.pendingSavedFiles = this.pendingSavedFiles.filter((item) => item !== filePath); wx.removeSavedFile({ filePath, fail: () => {} }); }
      else if (filePath) this.removedSavedFiles.push(filePath);
      this.updateTargetAssets(this.data.targetAssets.filter((_, itemIndex) => itemIndex !== index));
      return;
    }
    const asset = this.data.targetAssets[index]; if (!asset) return;
    this.removedCloudAssets.push(asset);
    const targetAssets = this.data.targetAssets.filter((_, itemIndex) => itemIndex !== index);
    this.updateTargetAssets(targetAssets);
  },
  updateTargetAssets(targetAssets) {
    const targetImages = targetAssets.map(item => item.preview == null ? item.fileId : item.preview);
    this.setData({ targetAssets, targetImages, targetImageRows: projectImagePreview.rows(targetImages, targetAssets) });
  },
  previewTargetImage: projectImagePreview,
  async save() {
    if (this.unloaded) return;
    if (!this.data.canSave || this.data.actionPending) return wx.showToast({ title: this.data.saveError || "请完成必填信息", icon: "none" });
    if (this.cloudMode) {
      const owner = getApp().globalData.account?.id, projectId = this.projectId;
      const current = () => !this.unloaded && this.projectId === projectId && owner === getApp().globalData.account?.id;
      const fields = {
        title: this.data.projectName.trim(), date: this.data.date.trim(), city: this.data.city.trim(), cityCode: this.data.cityCode, location: this.data.location.trim(),
        description: this.data.description.trim(), targetAssetIds: this.data.targetAssets.map((item) => item.assetId)
      };
      this.setData({ actionPending: true, loadError: "" });
      try {
        await cloudProjects.saveProject(projectId, this.data.project.version, fields);
        if (!current()) return;
        setDiscoveryContext({ city: fields.city, cityCode: fields.cityCode, date: fields.date });
        let preferenceSyncFailed = false;
        try {
          const { preference } = await cloudAccount.getDiscoveryPreference();
          if (!current()) return;
          await cloudAccount.saveDiscoveryPreference(preference ? preference.version : 0, { cityName: fields.city, cityCode: fields.cityCode }, "PROJECT");
        } catch { preferenceSyncFailed = true; }
        if (!current()) return;
        for (const asset of this.removedCloudAssets) {
          if (!current()) return;
          await cloudCatalog.cancelImage(asset.assetId, asset.fileId).catch(() => null);
        }
        if (!current()) return;
        this.pendingCloudAssets = []; this.removedCloudAssets = []; this.setData({ actionPending: false });
        if (preferenceSyncFailed) wx.showToast({ title: "项目已保存；发现页城市稍后再同步", icon: "none" });
        wx.navigateBack();
      } catch (error) {
        if (!current()) return;
        this.setData({ actionPending: false, loadError: error && error.code === "VERSION_CONFLICT" ? "项目已变化，请返回后重新进入。" : "项目保存失败，请稍后重试。" });
        wx.showToast({ title: this.data.loadError, icon: "none" });
      }
      return;
    }
    const project = Object.assign({}, this.data.project, { title: this.data.projectName.trim(), shortTitle: this.data.projectName.trim(), date: this.data.date.trim(), city: this.data.city.trim(), cityCode: this.data.cityCode, location: this.data.location.trim(), description: this.data.description.trim(), targetImages: this.data.targetImages.slice(0, MAX_TARGET_IMAGES), briefSaved: true, projectModelVersion: 2, brief: { date: this.data.date.trim(), city: this.data.city.trim(), cityCode: this.data.cityCode, location: this.data.location.trim(), description: this.data.description.trim() } });
    projectModel.upsertProject(project); this.pendingSavedFiles = []; this.removedSavedFiles.forEach((filePath) => wx.removeSavedFile({ filePath, fail: () => {} })); this.removedSavedFiles = []; wx.navigateBack();
  },
  async onUnload() {
    this.unloaded = true;
    this.loadSequence = (this.loadSequence || 0) + 1;
    this.pendingSavedFiles.forEach((filePath) => wx.removeSavedFile({ filePath, fail: () => {} })); this.pendingSavedFiles = [];
    if (this.cloudMode) for (const asset of this.pendingCloudAssets) await cloudCatalog.cancelImage(asset.assetId, asset.fileId).catch(() => null);
    this.pendingCloudAssets = [];
  },
  retryLoad() { this.load(); }
});

module.exports = { FIELD_LABELS, MAX_TARGET_IMAGES, validation };
