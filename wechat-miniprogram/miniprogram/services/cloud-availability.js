const cloudCall = require("../utils/cloud-call");
const localPreview = require("../utils/local-preview");
const cloudbase = require("../config/cloudbase");

function isAvailable() {
  return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction);
}
function resultError(result) {
  const error = new Error(result && result.error && result.error.message || "云端档期请求失败");
  error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED";
  return error;
}
async function call(data) {
  if (!isAvailable()) { const error = new Error("当前环境未启用云服务"); error.code = "CLOUD_UNAVAILABLE"; throw error; }
  localPreview.assertCloudAllowed();
  const response = await cloudCall.call(wx, { name: "availability-api", data });
  if (!response || !response.result || !response.result.ok) throw resultError(response && response.result);
  return response.result.data;
}
function getMine() { return call({ action: "getMine" }); }
function getPublic(providerId) { return call({ action: "getPublic", providerId }); }
function saveMine(expectedVersion, openDates, accepting) { return call({ action: "saveMine", expectedVersion, ...(openDates == null ? {} : { openDates }), ...(typeof accepting === "boolean" ? { accepting } : {}) }); }

module.exports = { getMine, getPublic, isAvailable, saveMine };
