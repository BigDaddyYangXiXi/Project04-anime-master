const displayCache = require("../utils/display-cache");
const cloudCall = require("../utils/cloud-call");
const localPreview = require("../utils/local-preview");
const cloudAccount = require("./cloud-account");
const cloudbase = require("../config/cloudbase");
const imagePerformance = require("../utils/image-performance");

function isAvailable() {
  return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction);
}

function failFromResult(result) {
  const error = new Error(result && result.error && result.error.message || "云端请求失败");
  error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED";
  error.details = result && result.error && result.error.details || null;
  return error;
}

async function call(name, data) {
  if (!isAvailable()) {
    const error = new Error("当前环境未启用云服务");
    error.code = "CLOUD_UNAVAILABLE";
    throw error;
  }
  localPreview.assertCloudAllowed();
  const invoke = async () => {
    const response = await cloudCall.call(wx, { name, data });
    if (!response || !response.result || !response.result.ok) throw failFromResult(response && response.result);
    return response.result.data;
  };
  return name === "media-upload" || name === "media-security-submit"
    ? imagePerformance.measure(data.action, invoke) : invoke();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

let urlOwner = null;
let urlRevision = 0;
const urlCache = new Map(), urlPending = new Map();
function clearImageCache() {
  urlRevision++; urlOwner = null; urlCache.clear(); urlPending.clear();
}
async function resolveFileIds(fileIds) {
  const ids = unique(fileIds);
  if (!ids.length) return {};
  const owner = currentAccount() && currentAccount().id;
  if (owner !== urlOwner) { clearImageCache(); urlOwner = owner; }
  const revision = urlRevision;
  const urls = {}, missing = [], now = Date.now();
  for (const id of ids) {
    const cached = owner && urlCache.get(id);
    if (cached && cached.expiresAt > now) urls[id] = cached.url;
    else { urlCache.delete(id); missing.push(id); }
  }
  if (!missing.length) return urls;
  const key = JSON.stringify(missing.slice().sort());
  let request = owner && urlPending.get(key);
  if (!request) {
    request = imagePerformance.measure("imageUrls", () => wx.cloud.getTempFileURL({ fileList: missing }));
    if (owner) urlPending.set(key, request);
  }
  try {
    const response = await request;
    if (revision !== urlRevision || (currentAccount() && currentAccount().id) !== owner) throw new Error("账号已切换，请重新打开页面");
    for (const item of response.fileList || []) {
      if (!missing.includes(item.fileID) || item.status || !item.tempFileURL) continue;
      urls[item.fileID] = item.tempFileURL;
      if (owner) urlCache.set(item.fileID, { url: item.tempFileURL, expiresAt: now + 15 * 60 * 1000 });
    }
    while (urlCache.size > 128) urlCache.delete(urlCache.keys().next().value);
    return urls;
  } finally { if (urlPending.get(key) === request) urlPending.delete(key); }
}

function toClientDraft(draft, account, media = []) {
  const mediaById = Object.fromEntries(media.map((item) => [item.assetId, item]));
  const profile = draft.profile || {};
  const previewFor = (assetId) => {
    const item = mediaById[assetId];
    return item && (item.tempFileURL || item.fileId) || "";
  };
  return {
    career: profile.career || "",
    profile: {
      nickname: account && account.nickname || "",
      avatar: account && (account.avatarUrl || account.avatar) || "",
      uid: account && account.uid || "",
      username: account && account.username || "",
      city: profile.city || "",
      cityCode: profile.cityCode || "",
      district: profile.district || "",
      specialties: profile.specialties || "",
      declines: profile.declines || "",
      contactHours: profile.contactHours || "",
      accepting: profile.accepting !== false,
      bannerSourceAssetId: profile.bannerSourceAssetId || null,
      bannerSourceImage: previewFor(profile.bannerSourceAssetId),
      bannerFocusX: profile.bannerFocusX == null ? 50 : profile.bannerFocusX,
      bannerFocusY: profile.bannerFocusY == null ? 50 : profile.bannerFocusY,
      bannerAssetId: profile.bannerAssetId || null,
      bannerImage: previewFor(profile.bannerAssetId),
      bio: profile.bio || "",
      notice: profile.notice || "",
      tags: (profile.tags || []).join(",")
    },
    services: (draft.services || []).map((service) => ({
      id: service.id,
      name: service.name,
      price: Number(service.priceFen || 0) / 100,
      unit: service.unit,
      description: service.description,
      workIds: service.workIds || [],
      serviceMode: service.serviceMode || "ONSITE",
      includes: service.includes || "",
      extras: service.extras || "",
      preparation: service.preparation || "",
      serviceAreas: service.serviceAreas || []
    })),
    works: (draft.works || []).map((work) => ({
      id: work.id,
      code: work.code || "系统生成",
      title: work.title,
      subtitle: work.subtitle,
      creditCoser: work.creditCoser || "",
      creditPhoto: work.creditPhoto || "",
      creditMakeup: work.creditMakeup || "",
      creditRetouch: work.creditRetouch || "",
      creditMine: work.creditMine || "",
      sourceImageAssetIds: work.sourceImageAssetIds || work.imageAssetIds || [],
      sourceImagePreviews: (work.sourceImageAssetIds || work.imageAssetIds || []).map(previewFor),
      sourceMediaStatuses: (work.sourceImageAssetIds || work.imageAssetIds || []).map(id => mediaById[id] && mediaById[id].status || "PENDING_SECURITY_REVIEW"),
      watermarks: work.watermarks || (work.imageAssetIds || []).map(() => null),
      price: work.priceFen == null ? null : Number(work.priceFen) / 100,
      description: work.description,
      tone: work.tone || "coral",
      tags: work.tags || [],
      referenceCount: Number(work.referenceCount || 0),
      imageAssetIds: work.imageAssetIds || [],
      imagePreviews: (work.imageAssetIds || []).map(previewFor),
      imageCount: (work.imageAssetIds || []).length,
      mediaStatuses: (work.imageAssetIds || []).map((id) => mediaById[id] && mediaById[id].status || "PENDING_SECURITY_REVIEW")
    })),
    pinnedWorkIds: draft.pinnedWorkIds || [],
    noticeImageAssetId: profile.noticeImageAssetId || null,
    noticeImage: previewFor(profile.noticeImageAssetId)
  };
}

function toServerDraft({ career, profile, services, works, pinnedWorkIds, noticeImageAssetId }) {
  return {
    profile: {
      career: career || "",
      city: profile && profile.city || "",
      cityCode: profile && profile.cityCode || "",
      district: profile && profile.district || "",
      specialties: profile && profile.specialties || "",
      declines: profile && profile.declines || "",
      contactHours: profile && profile.contactHours || "",
      accepting: !profile || profile.accepting !== false,
      bio: profile && profile.bio || "",
      notice: profile && profile.notice || "",
      noticeImageAssetId: noticeImageAssetId || null,
      bannerSourceAssetId: profile && profile.bannerSourceAssetId || null,
      bannerFocusX: profile && profile.bannerFocusX != null ? profile.bannerFocusX : 50,
      bannerFocusY: profile && profile.bannerFocusY != null ? profile.bannerFocusY : 50,
      bannerAssetId: profile && profile.bannerAssetId || null,
      tags: unique(String(profile && profile.tags || "").split(/[,，]/).map((item) => item.trim()))
    },
    services: (services || []).map((service) => ({
      id: String(service.id),
      name: service.name || "",
      priceFen: Math.round(Number(service.price || 0) * 100),
      unit: service.unit || "",
      description: service.description || "",
      workIds: service.workIds || [],
      serviceMode: service.serviceMode || "ONSITE",
      includes: service.includes || "",
      extras: service.extras || "",
      preparation: service.preparation || "",
      serviceAreas: service.serviceAreas || []
    })),
    works: (works || []).map((work) => ({
      id: String(work.id),
      title: work.title || "",
      subtitle: work.subtitle || "",
      creditCoser: work.creditCoser || "",
      creditPhoto: work.creditPhoto || "",
      creditMakeup: work.creditMakeup || "",
      creditRetouch: work.creditRetouch || "",
      creditMine: work.creditMine || "",
      ...(work.sourceImageAssetIds && work.sourceImageAssetIds.length ? { sourceImageAssetIds: work.sourceImageAssetIds, watermarks: work.watermarks || work.sourceImageAssetIds.map(() => null) } : {}),
      priceFen: work.price == null || work.price === "" ? null : Math.round(Number(work.price) * 100),
      description: work.description || "",
      tone: work.tone || "coral",
      tags: work.tags || [],
      imageAssetIds: work.imageAssetIds || []
    })),
    pinnedWorkIds: pinnedWorkIds || []
  };
}

let imageEditingVersion = null;
let draftCache = null, draftPending = null, draftRevision = 0;
let storefrontState = null, ownProviderCache = null, ownProviderPending = null, storefrontRevision = 0;
const STOREFRONT_MAX_AGE_MS = 15 * 60 * 1000;
function clearStorefrontState() {
  storefrontRevision++; storefrontState = null; ownProviderCache = null; ownProviderPending = null;
  clearDraftCache();
}
function seedSession(session) {
  const owner = displayCache.owner();
  if (!owner || !session || !session.account || session.account.id !== owner) return;
  clearStorefrontState();
  const state = session.storefrontState;
  if (state && Number.isSafeInteger(state.draftVersion) && state.draftVersion >= 0 && typeof state.hasPublication === "boolean") {
    storefrontState = { ...state, owner, at: Date.now() };
  }
}
function peekStorefrontState() {
  const age = storefrontState ? Date.now() - storefrontState.at : -1;
  return storefrontState && storefrontState.owner === displayCache.owner() && age >= 0 && age < STOREFRONT_MAX_AGE_MS ? storefrontState : null;
}
function clearDraftCache() { draftRevision++; draftCache = null; draftPending = null; }
function peekDraft() {
  const owner = displayCache.owner(), age = draftCache ? Date.now() - draftCache.at : -1;
  if (!owner) return null;
  if (draftCache && draftCache.owner === owner && draftCache.displayRevision === displayCache.revision() && age >= 0 && age < STOREFRONT_MAX_AGE_MS) return JSON.parse(JSON.stringify(draftCache.value));
  const state = peekStorefrontState();
  if (state && state.draftVersion === 0) {
    const account = cloudAccount.peekMine();
    if (!account || account.id !== owner) return null;
    const draft = { profile: {}, services: [], works: [], pinnedWorkIds: [] };
    return { providerId: owner, version: 0, updatedAt: null, draft, clientDraft: toClientDraft(draft, account) };
  }
  return null;
}
function prefetchDraft() {
  // Only warm the raw text/asset IDs; media status and URLs stay demand-loaded.
  if (peekDraft()) return Promise.resolve();
  return call("provider-catalog-draft", { action: "getDraft" });
}
function getDraft() {
  const cached = peekDraft();
  if (cached) return Promise.resolve(cached);
  const owner = displayCache.owner(), revision = draftRevision, displayRevision = displayCache.revision();
  if (owner && draftPending && draftPending.owner === owner && draftPending.revision === revision && draftPending.displayRevision === displayRevision) return draftPending.promise.then(value => JSON.parse(JSON.stringify(value)));
  const promise = readDraft().then(value => {
    const ready = !['PENDING','STAGED'].includes(value.contentIntent?.status) && value.mediaReady === true;
    if (ready && owner && owner === displayCache.owner() && revision === draftRevision && displayRevision === displayCache.revision()) draftCache = { owner, at: Date.now(), displayRevision, value };
    return value;
  }).finally(() => { if (draftPending && draftPending.promise === promise) draftPending = null; });
  draftPending = { owner, revision, displayRevision, promise };
  return promise.then(value => JSON.parse(JSON.stringify(value)));
}
async function readDraft() {
  const owner = currentAccount() && currentAccount().id;
  const assertOwner = (data, account) => {
    if (!owner || (currentAccount() && currentAccount().id) !== owner || data.providerId !== owner || account.id !== owner) {
      const error = new Error("账号资料已变化，请重新打开橱窗");
      error.code = "ACCOUNT_CHANGED";
      throw error;
    }
  };
  const [data, account] = await Promise.all([call("provider-catalog-draft", { action: "getDraft" }), cloudAccount.getMine()]);
  assertOwner(data, account);
  const assetIds = unique([
    data.draft.profile && data.draft.profile.noticeImageAssetId,
    data.draft.profile && data.draft.profile.bannerAssetId,
    data.draft.profile && data.draft.profile.bannerSourceAssetId,
    ...data.draft.works.flatMap((work) => [...(work.imageAssetIds || []), ...(work.sourceImageAssetIds || [])])
  ]);
  let media = [];
  if (assetIds.length) {
    for (let offset = 0; offset < assetIds.length; offset += 100) {
      media.push(...(await call("media-upload", { action: "getOwnedMedia", assetIds: assetIds.slice(offset, offset + 100) })).assets);
    }
    const urls = await resolveFileIds(media.map((item) => item.fileId));
    media = media.map((item) => ({ ...item, tempFileURL: urls[item.fileId] || item.fileId || "" }));
  }
  assertOwner(data, account);
  imageEditingVersion = data.imageEditingVersion || 0;
  return { ...data, mediaReady: assetIds.every(id => media.some(asset => asset.assetId === id && asset.status === "READY")), clientDraft: toClientDraft(data.draft, account, media) };
}

function currentAccount() {
  if (typeof getApp === "function") {
    const app = getApp();
    if (app && app.globalData && app.globalData.account) return app.globalData.account;
  }
  return null;
}

function fileExtension(path) {
  const match = String(path || "").toLowerCase().match(/\.([a-z0-9]+)(?:\?|$)/);
  return match ? match[1] : "";
}

async function imageMetadata(file) {
  const image = await new Promise((resolve, reject) => wx.getImageInfo({ src: file.tempFilePath, success: resolve, fail: reject }));
  const type = String(image.type || fileExtension(file.tempFilePath)).toLowerCase();
  const mimeType = type === "jpg" || type === "jpeg" ? "image/jpeg" : type === "png" ? "image/png" : type === "webp" ? "image/webp" : "";
  if (!mimeType) {
    const error = new Error("仅支持 JPEG、PNG 或 WebP 图片");
    error.code = "UNSUPPORTED_MEDIA_TYPE";
    throw error;
  }
  const sizeBytes = Number(file.size) || Number((await new Promise((resolve, reject) => wx.getFileInfo({ filePath: file.tempFilePath, success: resolve, fail: reject }))).size);
  return { mimeType, sizeBytes };
}

async function compressUpload(file, meta, purpose) {
  if (file.preserveOriginal) return { file, meta };
  // Keep originals for delivery and preserve transparent/non-JPEG images.
  if (!["AVATAR", "NOTICE_IMAGE", "PROVIDER_BANNER", "WORK_IMAGE", "PROJECT_REFERENCE", "PROJECT_TARGET"].includes(purpose)
    || meta.mimeType !== "image/jpeg" || meta.sizeBytes <= 1024 * 1024 || !wx.compressImage) return { file, meta };
  try {
    const compressed = await new Promise((resolve, reject) => wx.compressImage({
      src: file.tempFilePath, quality: 85, success: resolve, fail: reject
    }));
    const nextFile = { tempFilePath: compressed.tempFilePath };
    const nextMeta = await imageMetadata(nextFile);
    if (nextMeta.mimeType === "image/jpeg" && nextMeta.sizeBytes > 0 && nextMeta.sizeBytes < meta.sizeBytes * 0.9) return { file: nextFile, meta: nextMeta };
  } catch (_) { /* Compression is optional; the normal size/type validation still applies. */ }
  return { file, meta };
}

async function uploadImage(file, purpose) {
  const onProgress = file.onProgress;
  const owner = currentAccount() && currentAccount().id;
  const assertOwner = () => {
    if (!owner || (currentAccount() && currentAccount().id) !== owner) {
      const error = new Error("账号已变化，请重新选择图片");
      error.code = "ACCOUNT_CHANGED";
      throw error;
    }
  };
  assertOwner();
  let meta = await imagePerformance.measure("imageMetadata", () => imageMetadata(file));
  ({ file, meta } = await imagePerformance.measure("imageCompression", () => compressUpload(file, meta, purpose)));
  let prepared = null;
  let fileId = "";
  let reviewRequested = false;
  try {
    assertOwner();
    prepared = await imagePerformance.measure("imagePrepare", () => call("media-upload", {
      action: "prepareUpload",
      purpose,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      originalFilename: file.tempFilePath.split(/[\\/]/).pop()
    }));
    assertOwner();
    const uploaded = await imagePerformance.measure("imageTransfer", () => typeof onProgress !== 'function' ? wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: file.tempFilePath }) : new Promise((resolve, reject) => {
      const task = wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: file.tempFilePath, success: resolve, fail: reject });
      if (task && task.onProgressUpdate) task.onProgressUpdate(onProgress);
    }));
    fileId = uploaded.fileID;
    assertOwner();
    await imagePerformance.measure("imageCommit", () => call("media-upload", { action: "commitUpload", assetId: prepared.assetId, fileId }));
    assertOwner();
    reviewRequested = true;
    let review;
    try {
      review = await imagePerformance.measure("imageSubmit", () => call("media-security-submit", { action: "submitImage", assetId: prepared.assetId }));
    } catch (error) {
      assertOwner();
      // A lost response does not mean the review was rejected. Read its state
      // without submitting again or deleting a possibly active review.
      review = await getImageStatus(prepared.assetId).catch(() => { throw error; });
      if (!review || review.assetId !== prepared.assetId
        || !["READY", "REJECTED", "PENDING_SECURITY_REVIEW"].includes(review.status)) throw error;
    }
    assertOwner();
    return { assetId: prepared.assetId, fileId, preview: file.tempFilePath, status: review.status };
  } catch (error) {
    if (prepared && reviewRequested && (currentAccount() && currentAccount().id) === owner) error.recoverableUpload = { assetId: prepared.assetId, fileId, preview: file.tempFilePath, status: "PENDING_SECURITY_REVIEW" };
    if (prepared && !reviewRequested && (currentAccount() && currentAccount().id) === owner) await call("media-upload", { action: "cancelUpload", assetId: prepared.assetId, fileId: fileId || undefined }).catch(() => null);
    throw error;
  }
}

async function cancelImage(assetId, fileId) {
  return call("media-upload", { action: "cancelUpload", assetId, fileId: fileId || undefined });
}

async function getImageStatus(assetId) {
  return call("media-security-submit", { action: "getImageStatus", assetId });
}

async function saveDraft(expectedVersion, value) {
  const hasImageMetadata = (value.works || []).some(work => ['creditCoser','creditPhoto','creditMakeup','creditRetouch','creditMine'].some(key => work[key]) || (work.watermarks || []).some(Boolean));
  if (imageEditingVersion === null && hasImageMetadata) {
    const capability = await call('provider-catalog-draft', { action: 'getDraft' });
    imageEditingVersion = capability.imageEditingVersion || 0;
  }
  if (imageEditingVersion < 1 && hasImageMetadata) {
    const error = new Error('图片与署名功能尚未启用，本次修改已保留，请稍后再保存'); error.code = 'IMAGE_EDITING_UNAVAILABLE'; throw error;
  }
  clearStorefrontState();
  try { return await call("provider-catalog-draft", { action: "saveDraft", schemaVersion: 2, expectedVersion, draft: toServerDraft(value) }); }
  finally { clearStorefrontState(); }
}

function resetPublicationRequest() { try { wx.removeStorageSync('animeMasterPublicationRequestV2'); } catch (_) {} }
async function publishDraft(expectedVersion) {
  clearStorefrontState();
  const owner = displayCache.owner();
  let request;
  try { request = wx.getStorageSync('animeMasterPublicationRequestV2'); } catch (_) {}
  if (!request || request.owner !== owner || request.version !== expectedVersion) {
    request = { owner, version: expectedVersion, key: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) };
    try { wx.setStorageSync('animeMasterPublicationRequestV2', request); } catch (_) {}
  }
  try {
    const result = await imagePerformance.measure("publicationSubmit", () => call("provider-catalog-draft", { action: "publishDraft", expectedVersion, requestKey: request.key }));
    if (result?.queued && owner === displayCache.owner()) { try { wx.setStorageSync("animeMasterPublicationIntentV1", { id: result.intentId, owner, version: expectedVersion, at: Date.now() }); } catch (_) {} }
    if (owner && owner === displayCache.owner()) displayCache.clear();
    return result;
  } finally { clearStorefrontState(); }
}

async function getProvider(providerId, { images = true } = {}) {
  const id = providerId || currentAccount() && currentAccount().id;
  if (!id) {
    const error = new Error("云端账号尚未初始化");
    error.code = "ACCOUNT_NOT_READY";
    throw error;
  }
  const owner = displayCache.owner();
  const state = id === owner ? peekStorefrontState() : null;
  if (state && state.hasPublication === false) return { provider: null };
  const revision = storefrontRevision, displayRevision = displayCache.revision();
  const age = ownProviderCache ? Date.now() - ownProviderCache.at : -1;
  const cached = id === owner && !images && ownProviderCache && ownProviderCache.owner === owner && ownProviderCache.displayRevision === displayRevision && age >= 0 && age < STOREFRONT_MAX_AGE_MS;
  let data;
  if (cached) data = JSON.parse(JSON.stringify(ownProviderCache.value));
  else if (id === owner && !images) {
    let pending = ownProviderPending;
    if (!pending || pending.owner !== owner || pending.revision !== revision || pending.displayRevision !== displayRevision) {
      const promise = call("catalog-read", { action: "getProvider", providerId: id }).then(value => {
        if (owner === displayCache.owner() && revision === storefrontRevision && displayRevision === displayCache.revision()) ownProviderCache = { owner, at: Date.now(), displayRevision, value };
        return value;
      }).finally(() => { if (ownProviderPending && ownProviderPending.promise === promise) ownProviderPending = null; });
      pending = ownProviderPending = { owner, revision, displayRevision, promise };
    }
    data = JSON.parse(JSON.stringify(await pending.promise));
  } else data = await call("catalog-read", { action: "getProvider", providerId: id });
  if (!data.provider || !images) return data;
  const fileIds = unique([
    data.provider.avatarFileId,
    data.provider.noticeImageFileId,
    data.provider.bannerFileId,
    ...data.provider.works.flatMap((work) => work.imageFileIds || [])
  ]);
  const urls = await resolveFileIds(fileIds);
  return {
    provider: {
      ...data.provider,
      avatarUrl: urls[data.provider.avatarFileId] || "",
      noticeImageUrl: urls[data.provider.noticeImageFileId] || "",
      bannerImage: urls[data.provider.bannerFileId] || "",
      works: data.provider.works.map((work) => ({
        ...work,
        imageUrls: (work.imageFileIds || []).map((fileId) => urls[fileId] || "").filter(Boolean)
      }))
    }
  };
}

async function getWork(workId, providerId) {
  const data = await call("catalog-read", { action: "getWork", workId, ...(providerId ? { providerId } : {}) });
  if (!data.work) return data;
  const urls = await resolveFileIds([...(data.work.imageFileIds || []), data.work.provider && data.work.provider.avatarFileId]);
  return {
    work: {
      ...data.work,
      imageUrls: (data.work.imageFileIds || []).map((fileId) => urls[fileId] || "").filter(Boolean),
      provider: data.work.provider ? { ...data.work.provider, avatarUrl: urls[data.work.provider.avatarFileId] || "" } : null
    }
  };
}

async function listProviders() {
  const data = await call("catalog-read", { action: "listProviders" });
  const fileIds = unique(data.providers.flatMap((provider) => [
    provider.avatarFileId,
    provider.noticeImageFileId,
    provider.bannerFileId,
    ...provider.works.flatMap((work) => work.imageFileIds || [])
  ]));
  const urls = await resolveFileIds(fileIds);
  return {
    providers: data.providers.map((provider) => ({
      ...provider,
      avatarUrl: urls[provider.avatarFileId] || "",
      noticeImageUrl: urls[provider.noticeImageFileId] || "",
      bannerImage: urls[provider.bannerFileId] || "",
      works: provider.works.map((work) => ({
        ...work,
        imageUrls: (work.imageFileIds || []).map((fileId) => urls[fileId] || "").filter(Boolean)
      }))
    }))
  };
}

async function listDiscovery(filters) {
  const data = await call("catalog-read", { action: "listDiscovery", ...(filters || {}) });
  const fileIds = unique((data.providers || []).flatMap((provider) => [
    provider.avatarFileId,
    ...provider.works.flatMap((work) => (work.imageFileIds || []).slice(0, 1))
  ]));
  const urls = await resolveFileIds(fileIds);
  return {
    ...data,
    providers: (data.providers || []).map((provider) => ({
      ...provider,
      avatarUrl: urls[provider.avatarFileId] || "",
      works: provider.works.map((work) => ({ ...work, imageUrls: (work.imageFileIds || []).slice(0, 1).map((fileId) => urls[fileId] || "").filter(Boolean) }))
    }))
  };
}

module.exports = {
  getWorkspaceReview: async () => {
    const owner = currentAccount()?.id;
    const result = await call('provider-catalog-draft', { action: 'getWorkspaceReview' });
    if (!owner || currentAccount()?.id !== owner || result.providerId !== owner) throw Object.assign(new Error('账号已变化'), { code:'ACCOUNT_CHANGED' });
    return result;
  },
  resolveFileIds,
  seedSession,
  peekStorefrontState,
  prefetchDraft,
  clearStorefrontState,
  clearImageCache,
  cancelImage,
  getDraft,
  peekDraft,
  clearDraftCache,
  getImageStatus,
  getProvider,
  getWork,
  isAvailable,
  listDiscovery,
  listProviders,
  getPublishIntent: async (intentId, expectedVersion) => {
    const owner = displayCache.owner();
    const result = await call("provider-catalog-draft", { action: "getPublishIntent", intentId, expectedVersion });
    if (result?.status === "APPLIED" && owner === displayCache.owner()) { clearStorefrontState(); displayCache.clear(); }
    return result;
  },
  publishDraft,
  saveDraft,
  toClientDraft,
  toServerDraft,
  resetPublicationRequest,
  cancelPublishIntent: intentId => call("provider-catalog-draft", { action: "cancelPublishIntent", intentId }),
  uploadImage
};
