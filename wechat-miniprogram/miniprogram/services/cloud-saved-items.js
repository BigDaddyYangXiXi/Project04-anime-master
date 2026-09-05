const cloudbase = require("../config/cloudbase");
function isAvailable() { return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction); }
function resultError(result) { const error = new Error(result && result.error && result.error.message || "云端收藏请求失败"); error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED"; return error; }
async function call(data) { if (!isAvailable()) { const error = new Error("当前环境未启用云服务"); error.code = "CLOUD_UNAVAILABLE"; throw error; } const response = await wx.cloud.callFunction({ name: "saved-items-api", data }); if (!response || !response.result || !response.result.ok) throw resultError(response && response.result); return response.result.data; }
function listMine() { return call({ action: "listMine" }); }
function setSaved(targetType, targetId, saved) { return call({ action: "setSaved", targetType, targetId, saved }); }
module.exports = { isAvailable, listMine, setSaved };
