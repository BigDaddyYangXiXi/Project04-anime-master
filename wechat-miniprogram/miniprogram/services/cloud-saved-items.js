const cloudCall = require("../utils/cloud-call");
const localPreview = require("../utils/local-preview");
const cloudbase = require("../config/cloudbase");
const displayCache = require("../utils/display-cache");
let cache = null, pending = null, revision = 0;
function ownerId() { const app = typeof getApp === "function" ? getApp() : null; return app && app.globalData && app.globalData.account && app.globalData.account.id; }
function clearCache() { revision++; cache = null; pending = null; }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function isAvailable() { return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction); }
function resultError(result) { const error = new Error(result && result.error && result.error.message || "云端收藏请求失败"); error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED"; return error; }
async function call(data) { localPreview.assertCloudAllowed(); if (!isAvailable()) { const error = new Error("当前环境未启用云服务"); error.code = "CLOUD_UNAVAILABLE"; throw error; } const response = await cloudCall.call(wx, { name: "saved-items-api", data }); if (!response || !response.result || !response.result.ok) throw resultError(response && response.result); return response.result.data; }
function listMine() {
  const owner = ownerId(), generation = revision;
  const age = cache ? Date.now() - cache.at : -1;
  if (owner && cache && cache.owner === owner && age >= 0 && age < 15 * 60 * 1000) return Promise.resolve(copy(cache.value));
  if (owner && pending && pending.owner === owner && pending.generation === generation) return pending.promise.then(copy);
  const promise = call({ action: "listMine" }).then(value => {
    if (owner && owner === ownerId() && generation === revision) cache = { owner, at: Date.now(), value: copy(value) };
    return value;
  }).finally(() => { if (pending && pending.promise === promise) pending = null; });
  pending = { owner, generation, promise };
  return promise.then(copy);
}
async function setSaved(targetType, targetId, saved) {
  const owner = ownerId();
  clearCache();
  try {
    const value = await call({ action: "setSaved", targetType, targetId, saved });
    if (owner === ownerId()) displayCache.clear();
    return value;
  } finally { if (owner === ownerId()) clearCache(); }
}
function listReceived(type, cursor) { return call({ action: 'listReceived', type, cursor }); }
module.exports = { isAvailable, listMine, listReceived, setSaved, clearCache };
