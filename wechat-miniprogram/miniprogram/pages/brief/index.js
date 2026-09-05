const projectModel = require("../../data/project-model");
const cloudProjects = require("../../services/cloud-projects");
const cloudCatalog = require("../../services/cloud-catalog");
const cloudAccount = require("../../services/cloud-account");
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
    targetImages: [], targetAssets: [], canSave: false, saveError: "", loading: false, loadError: "", actionPending: false
  },
  onLoad(options) {
    this.pendingSavedFiles = []; this.removedSavedFiles = []; this.pendingCloudAssets = []; this.removedCloudAssets = [];
    this.projectId = options.id; this.cloudMode = options.audit !== "1";
    this.load();
  },
  async load() {
    if (this.cloudMode) {
      this.setData({ loading: true, loadError: "" });
      try { this.renderProject(await cloudProjects.getProject(this.projectId)); this.setData({ loading: false }); }
      catch (error) { this.setData({ loading: false, loadError: error && error.code === "PROJECT_NOT_FOUND" ? "没有找到这个项目。" : "项目读取失败，请稍后重试。" }); }
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
      targetAssets: assets.slice(0, MAX_TARGET_IMAGES), targetImages: assets.map((item) => item.preview || item.fileId).slice(0, MAX_TARGET_IMAGES)
    };
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
  async waitForCloudImage(asset) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const status = await cloudCatalog.getImageStatus(asset.assetId);
      if (status.status === "READY") return { ...asset, status: "READY" };
      if (["REJECTED", "DELETED"].includes(status.status)) throw new Error("图片未通过安全审核");
      await wait(1000);
    }
    throw new Error("图片仍在安全审核，请稍后重新添加");
  },
  chooseTargetImages() {
    const remaining = MAX_TARGET_IMAGES - this.data.targetImages.length;
    if (remaining <= 0 || this.data.actionPending) return wx.showToast({ title: `最多添加 ${MAX_TARGET_IMAGES} 张图片`, icon: "none" });
    wx.chooseMedia({ count: remaining, mediaType: ["image"], sizeType: ["compressed"], success: async ({ tempFiles }) => {
      wx.showLoading({ title: this.cloudMode ? "上传并审核图片" : "正在保存图片" });
      this.setData({ actionPending: true });
      const added = [];
      try {
        for (const file of (tempFiles || []).slice(0, remaining)) {
          if (this.cloudMode) {
            const uploaded = await cloudCatalog.uploadImage(file, "PROJECT_TARGET");
            this.pendingCloudAssets.push(uploaded);
            added.push(await this.waitForCloudImage(uploaded));
          } else added.push({ assetId: "", fileId: await this.saveTargetFile(file), preview: this.pendingSavedFiles[this.pendingSavedFiles.length - 1], status: "READY" });
        }
        const targetAssets = this.data.targetAssets.concat(added).slice(0, MAX_TARGET_IMAGES);
        this.setData({ targetAssets, targetImages: targetAssets.map((item) => item.preview || item.fileId), actionPending: false });
      } catch (error) {
        for (const asset of added) if (asset.assetId) await cloudCatalog.cancelImage(asset.assetId, asset.fileId).catch(() => null);
        this.setData({ actionPending: false }); wx.showToast({ title: error.message || "图片处理失败", icon: "none" });
      } finally { wx.hideLoading(); }
    } });
  },
  removeTargetImage(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.cloudMode) {
      const filePath = this.data.targetImages[index]; if (!filePath) return;
      if (this.pendingSavedFiles.includes(filePath)) { this.pendingSavedFiles = this.pendingSavedFiles.filter((item) => item !== filePath); wx.removeSavedFile({ filePath, fail: () => {} }); }
      else this.removedSavedFiles.push(filePath);
      this.setData({ targetImages: this.data.targetImages.filter((_, itemIndex) => itemIndex !== index), targetAssets: this.data.targetAssets.filter((_, itemIndex) => itemIndex !== index) });
      return;
    }
    const asset = this.data.targetAssets[index]; if (!asset) return;
    this.removedCloudAssets.push(asset);
    const targetAssets = this.data.targetAssets.filter((_, itemIndex) => itemIndex !== index);
    this.setData({ targetAssets, targetImages: targetAssets.map((item) => item.preview || item.fileId) });
  },
  previewTargetImage(event) { const current = this.data.targetImages[Number(event.currentTarget.dataset.index)]; if (current) wx.previewImage({ current, urls: this.data.targetImages }); },
  async save() {
    if (!this.data.canSave || this.data.actionPending) return wx.showToast({ title: this.data.saveError || "请完成必填信息", icon: "none" });
    if (this.cloudMode) {
      this.setData({ actionPending: true, loadError: "" });
      try {
        await cloudProjects.saveProject(this.projectId, this.data.project.version, {
          title: this.data.projectName.trim(), date: this.data.date.trim(), city: this.data.city.trim(), cityCode: this.data.cityCode, location: this.data.location.trim(),
          description: this.data.description.trim(), targetAssetIds: this.data.targetAssets.map((item) => item.assetId)
        });
        setDiscoveryContext({ city: this.data.city.trim(), cityCode: this.data.cityCode, date: this.data.date.trim() });
        let preferenceSyncFailed = false;
        try {
          const { preference } = await cloudAccount.getDiscoveryPreference();
          await cloudAccount.saveDiscoveryPreference(preference ? preference.version : 0, { cityName: this.data.city.trim(), cityCode: this.data.cityCode }, "PROJECT");
        } catch { preferenceSyncFailed = true; }
        for (const asset of this.removedCloudAssets) await cloudCatalog.cancelImage(asset.assetId, asset.fileId).catch(() => null);
        this.pendingCloudAssets = []; this.removedCloudAssets = []; this.setData({ actionPending: false });
        if (preferenceSyncFailed) wx.showToast({ title: "项目已保存；发现页城市稍后再同步", icon: "none" });
        wx.navigateBack();
      } catch (error) {
        this.setData({ actionPending: false, loadError: error && error.code === "VERSION_CONFLICT" ? "项目已变化，请返回后重新进入。" : "项目保存失败，请稍后重试。" });
        wx.showToast({ title: this.data.loadError, icon: "none" });
      }
      return;
    }
    const project = Object.assign({}, this.data.project, { title: this.data.projectName.trim(), shortTitle: this.data.projectName.trim(), date: this.data.date.trim(), city: this.data.city.trim(), cityCode: this.data.cityCode, location: this.data.location.trim(), description: this.data.description.trim(), targetImages: this.data.targetImages.slice(0, MAX_TARGET_IMAGES), briefSaved: true, projectModelVersion: 2, brief: { date: this.data.date.trim(), city: this.data.city.trim(), cityCode: this.data.cityCode, location: this.data.location.trim(), description: this.data.description.trim() } });
    projectModel.upsertProject(project); this.pendingSavedFiles = []; this.removedSavedFiles.forEach((filePath) => wx.removeSavedFile({ filePath, fail: () => {} })); this.removedSavedFiles = []; wx.navigateBack();
  },
  async onUnload() {
    this.pendingSavedFiles.forEach((filePath) => wx.removeSavedFile({ filePath, fail: () => {} })); this.pendingSavedFiles = [];
    if (this.cloudMode) for (const asset of this.pendingCloudAssets) await cloudCatalog.cancelImage(asset.assetId, asset.fileId).catch(() => null);
    this.pendingCloudAssets = [];
  },
  retryLoad() { this.load(); }
});

module.exports = { FIELD_LABELS, MAX_TARGET_IMAGES, validation };
