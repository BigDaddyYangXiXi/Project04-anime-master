const displayCache = require("../utils/display-cache");
const cloudCall = require("../utils/cloud-call");
const localPreview = require("../utils/local-preview");
const cloudbase = require("../config/cloudbase");
const PREFERENCE_KEY = "animeMasterConfirmedDiscoveryPreference";
const PROFILE_MAX_AGE_MS = 15 * 60 * 1000;
const AVATAR_MAX_AGE_MS = 15 * 60 * 1000;
let profileCache = null, profilePending = null, profileRevision = 0, preferenceRevision = 0;
let avatarCache = null;
let preferenceCache = null, preferencePending = null;
let preferenceStorageUsable = true;
function seedSession(session) {
  if (!session || !session.account || session.account.id !== ownerId() || !Object.prototype.hasOwnProperty.call(session, "discoveryPreference")) return;
  rememberPreference(ownerId(), ++preferenceRevision, { preference: session.discoveryPreference });
}
function sessionAccount() { const app = typeof getApp === "function" ? getApp() : null; return app && app.globalData && app.globalData.account; }
function ownerId() { const account = sessionAccount(); return account && account.id; }
function peekMine() {
  const account = sessionAccount();
  if (!account) return null;
  return profileCache && profileCache.owner === account.id
    ? profileCache.value : { ...account, avatarUrl: "" };
}
function peekDiscoveryPreference() {
  const owner = ownerId();
  if (!owner) return null;
  if (preferenceCache && preferenceCache.owner === owner) return preferenceCache.result.preference;
  if (!preferenceStorageUsable) return null;
  try {
    const saved = wx.getStorageSync(PREFERENCE_KEY);
    return saved && saved.accountId === owner ? saved.preference : null;
  } catch (_) { return null; }
}
function clearCache() {
  profileRevision++; preferenceRevision++;
  profileCache = null; profilePending = null;
  avatarCache = null;
  preferenceCache = null;
  preferencePending = null;
  preferenceStorageUsable = false;
  try { wx.removeStorageSync(PREFERENCE_KEY); } catch (_) { /* Optional display cache must not interrupt session cleanup. */ }
}
function isAvailable() { return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction); }
function errorFrom(result) { const error = new Error(result && result.error && result.error.message || "云端账号请求失败"); error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED"; return error; }
async function call(data) {
  if (!isAvailable()) { const error = new Error("当前环境未启用云服务"); error.code = "CLOUD_UNAVAILABLE"; throw error; }
  localPreview.assertCloudAllowed();
  const response = await cloudCall.call(wx, { name: "account-api", data });
  if (!response || !response.result || !response.result.ok) throw errorFrom(response && response.result);
  return response.result.data;
}
async function withAvatarUrl(account, owner, revision) {
  if (!account.avatarFileId) return { ...account, avatarUrl: "" };
  if (!owner || account.id !== owner || owner !== ownerId() || revision !== profileRevision) return { ...account, avatarUrl: "" };
  const age = avatarCache ? Date.now() - avatarCache.at : -1;
  if (avatarCache && avatarCache.owner === owner && avatarCache.fileId === account.avatarFileId && age >= 0 && age < AVATAR_MAX_AGE_MS) {
    return { ...account, avatarUrl: avatarCache.url };
  }
  const result = await wx.cloud.getTempFileURL({ fileList: [account.avatarFileId] });
  const file = result.fileList && result.fileList[0];
  const url = file && !file.status ? file.tempFileURL : "";
  if (url && owner === ownerId() && revision === profileRevision) avatarCache = { owner, fileId: account.avatarFileId, at: Date.now(), url };
  return { ...account, avatarUrl: url };
}
function rememberProfile(owner, revision, value) {
  if (owner && owner === ownerId() && revision === profileRevision && value.id === owner) {
    profileCache = { owner, at: Date.now(), value };
  }
  return value;
}
function getMine(options = {}) {
  if (options.force) { profileCache = null; profilePending = null; profileRevision++; }
  const owner = ownerId(), revision = profileRevision;
  const age = profileCache ? Date.now() - profileCache.at : -1;
  const cached = owner && profileCache && profileCache.owner === owner && age >= 0 && age < PROFILE_MAX_AGE_MS ? profileCache.value : null;
  const avatarAge = avatarCache ? Date.now() - avatarCache.at : -1;
  if (cached && (!cached.avatarFileId || cached.avatarUrl && avatarCache && avatarCache.owner === owner && avatarCache.fileId === cached.avatarFileId && avatarAge >= 0 && avatarAge < AVATAR_MAX_AGE_MS)) return Promise.resolve(cached);
  if (owner && profilePending && profilePending.owner === owner && profilePending.revision === revision) return profilePending.promise;
  const promise = (cached ? Promise.resolve(cached) : call({ action: "getMine" })).then(value => withAvatarUrl(value, owner, revision)).then(value => rememberProfile(owner, revision, value))
    .finally(() => { if (profilePending && profilePending.promise === promise) profilePending = null; });
  profilePending = { owner, revision, promise };
  return promise;
}
async function updateMine(expectedVersion, nickname, avatarAssetId, allowDeferred = false) {
  const owner = ownerId(), revision = ++profileRevision;
  profileCache = null;
  const value = await call({ action: "updateMine", expectedVersion, nickname, avatarAssetId, allowDeferred });
  if (owner === ownerId()) displayCache.clear();
  return rememberProfile(owner, revision, value);
}
function rememberPreference(owner, revision, result) {
  if (owner && owner === ownerId() && revision === preferenceRevision) {
    preferenceCache = { owner, at: Date.now(), result };
    try {
      wx.setStorageSync(PREFERENCE_KEY, { accountId: owner, preference: result.preference });
      preferenceStorageUsable = true;
    } catch (_) { preferenceStorageUsable = false; }
  }
  return result;
}
function getDiscoveryPreference() {
  const owner = ownerId(), revision = preferenceRevision;
  const age = preferenceCache ? Date.now() - preferenceCache.at : -1;
  if (owner && preferenceCache && preferenceCache.owner === owner && age >= 0 && age < PROFILE_MAX_AGE_MS) return Promise.resolve(preferenceCache.result);
  if (owner && preferencePending && preferencePending.owner === owner && preferencePending.revision === revision) return preferencePending.promise;
  const promise = call({ action: "getDiscoveryPreference" }).then(result => rememberPreference(owner, revision, result))
    .finally(() => { if (preferencePending && preferencePending.promise === promise) preferencePending = null; });
  preferencePending = { owner, revision, promise };
  return promise;
}
async function saveDiscoveryPreference(expectedVersion, region, source = "MANUAL") {
  const owner = ownerId(), revision = ++preferenceRevision;
  preferenceCache = null;
  return rememberPreference(owner, revision, await call({ action: "saveDiscoveryPreference", expectedVersion, region, source }));
}
async function resolveDiscoveryLocation(expectedVersion, latitude, longitude) {
 const owner=ownerId(),revision=++preferenceRevision;preferenceCache=null;
 return rememberPreference(owner,revision,await call({action:'resolveDiscoveryLocation',expectedVersion,latitude,longitude}));
}
module.exports = { resolveDiscoveryLocation, seedSession, clearCache, peekMine, peekDiscoveryPreference, getDiscoveryPreference, getMine, isAvailable, saveDiscoveryPreference, updateMine };
