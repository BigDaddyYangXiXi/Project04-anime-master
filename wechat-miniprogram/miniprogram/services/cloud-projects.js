const cloudbase = require("../config/cloudbase");

function isAvailable() { return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction); }
function errorFrom(result) { const error = new Error(result && result.error && result.error.message || "项目服务请求失败"); error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED"; return error; }
async function call(data) {
  if (!isAvailable()) { const error = new Error("当前环境未启用云项目服务"); error.code = "CLOUD_UNAVAILABLE"; throw error; }
  const response = await wx.cloud.callFunction({ name: "project-api", data });
  if (!response || !response.result || !response.result.ok) throw errorFrom(response && response.result);
  return response.result.data;
}
function toClient(project) {
  if (!project) return null;
  const images = project.targetImages || [];
  return { ...project, shortTitle: project.title, targetImageAssets: images, targetImages: images.map((item) => item.fileId) };
}
function listProjects() { return call({ action: "listProjects" }).then((data) => (data.projects || []).map(toClient)); }
function getProject(projectId) { return call({ action: "getProject", projectId }).then(toClient); }
function createProject(idempotencyKey) { return call({ action: "createProject", idempotencyKey }).then(toClient); }
function saveProject(projectId, expectedVersion, project) { return call({ action: "saveProject", projectId, expectedVersion, project }).then(toClient); }
function linkOrder(projectId, expectedVersion, orderId) { return call({ action: "linkOrder", projectId, expectedVersion, orderId }).then(toClient); }
function unlinkOrder(projectId, expectedVersion, orderId) { return call({ action: "unlinkOrder", projectId, expectedVersion, orderId }).then(toClient); }
function idempotencyKey() { return `project-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`; }

module.exports = { createProject, getProject, idempotencyKey, isAvailable, linkOrder, listProjects, saveProject, toClient, unlinkOrder };
