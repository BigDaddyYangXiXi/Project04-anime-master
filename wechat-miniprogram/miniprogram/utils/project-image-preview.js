const cloudProjects = require("../services/cloud-projects");

module.exports = async function previewTargetImage(event) {
  const index = Number(event.currentTarget.dataset.index);
  const project = this.data.project;
  const assets = this.data.targetAssets || project && project.targetImageAssets || [];
  const images = this.data.targetImages || project && project.targetImages || [];
  if (!Number.isInteger(index) || index < 0 || index >= images.length || this.targetPreviewPending) return;
  if (!this.cloudMode) {
    if (images[index]) wx.previewImage({ current: images[index], urls: images.filter(Boolean) });
    return;
  }
  const asset = assets[index];
  if (!asset || !asset.assetId) return;
  const projectId = this.projectId;
  const isCurrent = () => getCurrentPages().slice(-1)[0] === this && this.projectId === projectId
    && (this.data.targetAssets || this.data.project && this.data.project.targetImageAssets || []) === assets;
  this.targetPreviewPending = true;
  try {
    const fresh = await cloudProjects.getTargetImages(projectId, assets.map(item => item.assetId));
    if (!isCurrent()) return;
    const image = fresh.find(item => item.assetId === asset.assetId);
    if (!image || !image.url) throw new Error("IMAGE_UNAVAILABLE");
    const urls = assets.map(item => (fresh.find(candidate => candidate.assetId === item.assetId) || {}).url).filter(Boolean);
    await new Promise((resolve, reject) => wx.previewImage({ current: image.url, urls, success: resolve, fail: reject }));
  } catch (error) {
    if (isCurrent() && !/cancel/i.test(String(error && (error.errMsg || error.message)))) {
      wx.showToast({ title: "图片暂不可查看，请刷新或重新添加", icon: "none" });
    }
  } finally { this.targetPreviewPending = false; }
};

module.exports.rows = (images, assets = []) => images.map((url, index) => ({
  key: assets[index] && (assets[index].assetId || assets[index].fileId) || String(index),
  url
}));
