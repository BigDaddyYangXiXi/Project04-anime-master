const cloudbase = require("../config/cloudbase");
function isAvailable() { return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction); }
function errorFrom(result) { const error = new Error(result && result.error && result.error.message || "云端账号请求失败"); error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED"; return error; }
async function call(data) {
  if (!isAvailable()) { const error = new Error("当前环境未启用云服务"); error.code = "CLOUD_UNAVAILABLE"; throw error; }
  const response = await wx.cloud.callFunction({ name: "account-api", data });
  if (!response || !response.result || !response.result.ok) throw errorFrom(response && response.result);
  return response.result.data;
}
async function withAvatarUrl(account) {
  if (!account.avatarFileId) return { ...account, avatarUrl: "" };
  const result = await wx.cloud.getTempFileURL({ fileList: [account.avatarFileId] });
  const file = result.fileList && result.fileList[0];
  return { ...account, avatarUrl: file && !file.status ? file.tempFileURL : "" };
}
async function getMine() { return withAvatarUrl(await call({ action: "getMine" })); }
async function updateMine(expectedVersion, nickname, avatarAssetId) { return withAvatarUrl(await call({ action: "updateMine", expectedVersion, nickname, avatarAssetId })); }
async function getDiscoveryPreference() { return call({ action: "getDiscoveryPreference" }); }
async function saveDiscoveryPreference(expectedVersion, region, source = "MANUAL") { return call({ action: "saveDiscoveryPreference", expectedVersion, region, source }); }
module.exports = { getDiscoveryPreference, getMine, isAvailable, saveDiscoveryPreference, updateMine };
