const cloudCall = require("../utils/cloud-call");
const localPreview = require("../utils/local-preview");
const cloudbase = require("../config/cloudbase");

function isAvailable() { return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction); }
function errorFrom(result) { const error = new Error(result && result.error && result.error.message || "项目服务请求失败"); error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED"; return error; }
async function call(data) {
  if (!isAvailable()) { const error = new Error("当前环境未启用云项目服务"); error.code = "CLOUD_UNAVAILABLE"; throw error; }
  localPreview.assertCloudAllowed();
  const response = await cloudCall.call(wx, { name: "project-api", data });
  if (!response || !response.result || !response.result.ok) throw errorFrom(response && response.result);
  return response.result.data;
}
function toClient(project) {
  if (!project) return null;
  const images = project.targetImages || [];
  return { ...project, shortTitle: project.title, targetImageAssets: images, targetImages: images.map((item) => item.preview || "") };
}
function listProjects() { return call({ action: "listProjects" }).then((data) => (data.projects || []).map(toClient)); }
async function getTargetImages(projectId, assetIds) {
  return (await call({ action: "getTargetImages", projectId, assetIds })).images;
}
async function getProject(projectId) {
  const project = await call({ action: "getProject", projectId });
  const assets = project.targetImages || [];
  if (assets.length) {
    const images = await getTargetImages(projectId, assets.map(item => item.assetId));
    project.targetImages = assets.map(item => ({ ...item, preview: (images.find(image => image.assetId === item.assetId) || {}).url || "" }));
  }
  return toClient(project);
}
function createProject(idempotencyKey) { return call({ action: "createProject", idempotencyKey }).then(toClient); }
function saveProject(projectId, expectedVersion, project) { return call({ action: "saveProject", projectId, expectedVersion, project }).then(toClient); }
function linkOrder(projectId, expectedVersion, orderId) { return call({ action: "linkOrder", projectId, expectedVersion, orderId }).then(toClient); }
function unlinkOrder(projectId, expectedVersion, orderId) { return call({ action: "unlinkOrder", projectId, expectedVersion, orderId }).then(toClient); }
function idempotencyKey() { return `project-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`; }

module.exports = { createProject, getProject, getTargetImages, idempotencyKey, isAvailable, linkOrder, listProjects, saveProject, toClient, unlinkOrder };
