const cloudbase = require("../config/cloudbase");

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
  const response = await wx.cloud.callFunction({ name, data });
  if (!response || !response.result || !response.result.ok) throw failFromResult(response && response.result);
  return response.result.data;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

async function resolveFileIds(fileIds) {
  const ids = unique(fileIds);
  if (!ids.length) return {};
  const response = await wx.cloud.getTempFileURL({ fileList: ids });
  return Object.fromEntries((response.fileList || []).filter((item) => !item.status && item.tempFileURL)
    .map((item) => [item.fileID, item.tempFileURL]));
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
      city: profile.city || "",
      cityCode: profile.cityCode || "",
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
      serviceAreas: service.serviceAreas || []
    })),
    works: (draft.works || []).map((work) => ({
      id: work.id,
      code: work.code || "系统生成",
      title: work.title,
      subtitle: work.subtitle,
      price: Number(work.priceFen || 0) / 100,
      description: work.description,
      tone: work.tone || "coral",
      tags: work.tags || [],
      referenceCount: Number(work.referenceCount || 0),
      imageAssetIds: work.imageAssetIds || [],
      imagePreviews: (work.imageAssetIds || []).map(previewFor).filter(Boolean),
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
      bio: profile && profile.bio || "",
      notice: profile && profile.notice || "",
      noticeImageAssetId: noticeImageAssetId || null,
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
      serviceAreas: service.serviceAreas || []
    })),
    works: (works || []).map((work) => ({
      id: String(work.id),
      title: work.title || "",
      subtitle: work.subtitle || "",
      priceFen: Math.round(Number(work.price || 0) * 100),
      description: work.description || "",
      tone: work.tone || "coral",
      tags: work.tags || [],
      imageAssetIds: work.imageAssetIds || []
    })),
    pinnedWorkIds: pinnedWorkIds || []
  };
}

async function getDraft() {
  const data = await call("provider-catalog-draft", { action: "getDraft" });
  const assetIds = unique([
    data.draft.profile && data.draft.profile.noticeImageAssetId,
    ...data.draft.works.flatMap((work) => work.imageAssetIds || [])
  ]);
  let media = [];
  if (assetIds.length) {
    media = (await call("media-upload", { action: "getOwnedMedia", assetIds })).assets;
    const urls = await resolveFileIds(media.map((item) => item.fileId));
    media = media.map((item) => ({ ...item, tempFileURL: urls[item.fileId] || item.fileId || "" }));
  }
  return { ...data, clientDraft: toClientDraft(data.draft, currentAccount(), media) };
}

function currentAccount() {
  if (typeof getApp === "function") {
    const app = getApp();
    if (app && app.globalData && app.globalData.account) return app.globalData.account;
  }
  return typeof wx !== "undefined" && wx.getStorageSync ? wx.getStorageSync("animeMasterServerAccount") || null : null;
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

async function uploadImage(file, purpose) {
  const meta = await imageMetadata(file);
  let prepared = null;
  let fileId = "";
  try {
    prepared = await call("media-upload", {
      action: "prepareUpload",
      purpose,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      originalFilename: file.tempFilePath.split(/[\\/]/).pop()
    });
    const uploaded = await wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: file.tempFilePath });
    fileId = uploaded.fileID;
    await call("media-upload", { action: "commitUpload", assetId: prepared.assetId, fileId });
    const review = await call("media-security-submit", { action: "submitImage", assetId: prepared.assetId });
    return { assetId: prepared.assetId, fileId, preview: file.tempFilePath, status: review.status };
  } catch (error) {
    if (prepared) await call("media-upload", { action: "cancelUpload", assetId: prepared.assetId, fileId: fileId || undefined }).catch(() => null);
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
  return call("provider-catalog-draft", { action: "saveDraft", expectedVersion, draft: toServerDraft(value) });
}

async function publishDraft(expectedVersion) {
  return call("provider-catalog-draft", { action: "publishDraft", expectedVersion });
}

async function getProvider(providerId) {
  const id = providerId || currentAccount() && currentAccount().id;
  if (!id) {
    const error = new Error("云端账号尚未初始化");
    error.code = "ACCOUNT_NOT_READY";
    throw error;
  }
  const data = await call("catalog-read", { action: "getProvider", providerId: id });
  if (!data.provider) return data;
  const fileIds = unique([
    data.provider.avatarFileId,
    data.provider.noticeImageFileId,
    ...data.provider.works.flatMap((work) => work.imageFileIds || [])
  ]);
  const urls = await resolveFileIds(fileIds);
  return {
    provider: {
      ...data.provider,
      avatarUrl: urls[data.provider.avatarFileId] || "",
      noticeImageUrl: urls[data.provider.noticeImageFileId] || "",
      works: data.provider.works.map((work) => ({
        ...work,
        imageUrls: (work.imageFileIds || []).map((fileId) => urls[fileId] || "").filter(Boolean)
      }))
    }
  };
}

async function getWork(workId) {
  const data = await call("catalog-read", { action: "getWork", workId });
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
    ...provider.works.flatMap((work) => work.imageFileIds || [])
  ]));
  const urls = await resolveFileIds(fileIds);
  return {
    providers: data.providers.map((provider) => ({
      ...provider,
      avatarUrl: urls[provider.avatarFileId] || "",
      noticeImageUrl: urls[provider.noticeImageFileId] || "",
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
    ...provider.works.flatMap((work) => work.imageFileIds || [])
  ]));
  const urls = await resolveFileIds(fileIds);
  return {
    ...data,
    providers: (data.providers || []).map((provider) => ({
      ...provider,
      avatarUrl: urls[provider.avatarFileId] || "",
      works: provider.works.map((work) => ({ ...work, imageUrls: (work.imageFileIds || []).map((fileId) => urls[fileId] || "").filter(Boolean) }))
    }))
  };
}

module.exports = {
  cancelImage,
  getDraft,
  getImageStatus,
  getProvider,
  getWork,
  isAvailable,
  listDiscovery,
  listProviders,
  publishDraft,
  saveDraft,
  toClientDraft,
  toServerDraft,
  uploadImage
};
