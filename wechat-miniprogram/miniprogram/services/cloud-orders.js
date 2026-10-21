const cloudCall = require("../utils/cloud-call");
const localPreview = require("../utils/local-preview");
const cloudbase = require("../config/cloudbase");

function isAvailable() {
  return Boolean(cloudbase.enabled && cloudbase.env && typeof wx !== "undefined" && wx.cloud && wx.cloud.callFunction);
}

function cloudError(result) {
  const error = new Error(result && result.error && result.error.message || "订单服务请求失败");
  error.code = result && result.error && result.error.code || "CLOUD_REQUEST_FAILED";
  error.details = result && result.error && result.error.details || null;
  return error;
}

async function call(data) {
  if (!isAvailable()) {
    const error = new Error("当前环境未启用云订单服务");
    error.code = "CLOUD_UNAVAILABLE";
    throw error;
  }
  localPreview.assertCloudAllowed();
  const response = await cloudCall.call(wx, { name: "order-api", data });
  if (!response || !response.result || !response.result.ok) throw cloudError(response && response.result);
  return response.result.data;
}

async function callMedia(data) {
  if (!isAvailable()) {
    const error = new Error("当前环境未启用云媒体服务");
    error.code = "CLOUD_UNAVAILABLE";
    throw error;
  }
  localPreview.assertCloudAllowed();
  const response = await cloudCall.call(wx, { name: "media-upload", data });
  if (!response || !response.result || !response.result.ok) throw cloudError(response && response.result);
  return response.result.data;
}

function pad(value) { return String(value).padStart(2, "0"); }

function dateParts(value) {
  const date = new Date(value);
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}

function scheduleFromSegments(source) {
  const segments = (source || []).map((item, index) => {
    const start = dateParts(item.startsAt);
    const end = dateParts(item.endsAt);
    return { id: index + 1, startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time };
  });
  const first = segments[0] || {};
  return {
    timeMode: segments.length > 1 ? "segments" : "continuous",
    date: first.startDate || "",
    startDate: first.startDate || "",
    startTime: first.startTime || "",
    endDate: first.endDate || "",
    endTime: first.endTime || "",
    segments
  };
}

function scheduleText(segments) {
  return (segments || []).map((item) => {
    const start = dateParts(item.startsAt);
    const end = dateParts(item.endsAt);
    const startText = `${start.date.replace(/-/g, "/")} ${start.time}`;
    const endText = start.date === end.date ? end.time : `${end.date.replace(/-/g, "/")} ${end.time}`;
    return `${startText}—${endText}`;
  }).join("；") || "待确认时间";
}

function deliveryText(value) {
  if (value === "ONLINE") return "线上服务";
  if (value === "LOCAL") return "常驻城市到场";
  if (value === "SERVICE_AREA") return "覆盖城市到场";
  if (value === "LOCAL_OR_ONLINE") return "当前城市可到场或线上";
  if (value === "SERVICE_AREA_OR_ONLINE") return "覆盖城市可到场或线上";
  return "";
}

function toClientOrder(source) {
  if (!source) return null;
  const buyer = source.buyer || {};
  const provider = source.provider || {};
  const items = (source.items || []).map((item) => ({
    id: item.serviceId,
    name: item.name,
    serviceMode: item.serviceMode || "ONSITE",
    locationMatch: item.locationMatch || "",
    deliveryText: deliveryText(item.locationMatch),
    displayPrice: Number(item.displayPriceFen || 0) / 100,
    finalPrice: Number(item.finalPriceFen || 0) / 100
  }));
  const deliveryModes = [...new Set(items.map((item) => item.deliveryText).filter(Boolean))];
  const schedule = scheduleFromSegments(source.timeSegments);
  return {
    ...source,
    cloudOrder: true,
    buyerId: source.buyerId,
    buyerUid: buyer.uid || source.buyerId,
    buyer: buyer.nickname || "未命名用户",
    providerId: source.providerId,
    providerUid: provider.uid || source.providerId,
    provider: provider.nickname || "未命名服务方",
    career: provider.career || "",
    serviceItems: items,
    service: items.map((item) => item.name).join(" + "),
    deliveryText: deliveryModes.join(" + "),
    originalPrice: items.reduce((sum, item) => sum + item.displayPrice, 0),
    finalPrice: Number(source.amountFen || 0) / 100,
    time: scheduleText(source.timeSegments),
    requestedAt: source.createdAt,
    contact: source.contact || { name: "", wechat: "", phone: "" },
    reference: source.referenceWorkId || source.referenceAssetId && "已上传参考图片" || "未提供参考资料",
    bookingDraft: {
      providerId: source.providerId,
      workId: source.referenceWorkId || "",
      serviceIds: items.map((item) => item.id),
      city: source.city,
      cityCode: source.cityCode || "",
      contact: source.contact || { name: "", wechat: "", phone: "" },
      note: source.requirement,
      ndaRequired: source.ndaRequired === true,
      referenceMode: source.referenceWorkId ? "work" : source.referenceAssetId ? "file" : "none",
      referenceFile: source.referenceAssetId ? { name: "已上传参考图片", assetId: source.referenceAssetId, status: "READY" } : null,
      ...schedule
    }
  };
}

function createOrder(input) {
  return call({ action: "createOrder", ...input }).then(toClientOrder);
}

async function refreshPayment(orderId) {
  if (!isAvailable()) { const error = new Error('付款核对暂不可用'); error.code = 'CLOUD_UNAVAILABLE'; throw error; }
  localPreview.assertCloudAllowed();
  const response = await cloudCall.call(wx, { name: 'payment-api', data: { action: 'refreshPayment', orderId } });
  if (!response || !response.result || !response.result.ok) throw cloudError(response && response.result);
  const result = response.result.data;
  if (!result || !['QUERIED', 'FINAL', 'NOT_STARTED', 'THROTTLED'].includes(result.queryStatus)) throw cloudError(null);
  return result;
}

async function createPayment(orderId, expectedVersion) {
  if (!isAvailable()) { const error = new Error('付款服务暂不可用'); error.code = 'CLOUD_UNAVAILABLE'; throw error; }
  localPreview.assertCloudAllowed();
  // Stable across page rebuilds and lost responses; the server still checks ownership and version.
  const requestKey = `payment-${orderId}-version-${expectedVersion}`;
  const response = await cloudCall.call(wx, { name: 'payment-api', data: {
    action: 'createPayment', orderId, expectedVersion, requestKey
  } });
  if (!response || !response.result || !response.result.ok) throw cloudError(response && response.result);
  const result = response.result.data;
  if (!result || !['READY', 'BUSY', 'QUERY_REQUIRED', 'PAID', 'PAID_REQUIRES_REVIEW', 'CLOSED'].includes(result.status)) throw cloudError(null);
  return result;
}

function getOrder(orderId) {
  return call({ action: "getOrder", orderId }).then(toClientOrder);
}

function getDeliveryDownload(orderId, assetId) {
  return call({ action: "getDeliveryDownload", orderId, assetId });
}

function getReferenceDownload(orderId) {
  return call({ action: "getReferenceDownload", orderId });
}

function listOrders() {
  return call({ action: "listOrders" }).then((data) => (data.orders || []).map(toClientOrder));
}

function getProviderFunds(cursor = null) {
  return call({ action: "getProviderFunds", cursor });
}

function transitionOrder(orderId, expectedVersion, event, fields = {}) {
  return call({ action: "transitionOrder", orderId, expectedVersion, event, ...fields }).then(toClientOrder);
}

const DELIVERY_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "pdf", "zip", "txt"]);
const DELIVERY_MIME_BY_EXTENSION = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", zip: "application/zip", txt: "text/plain"
};

function deliveryExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match && match[1];
  if (!DELIVERY_EXTENSIONS.has(extension)) {
    const error = new Error("交付文件仅支持图片、PDF、ZIP 或 TXT");
    error.code = "DELIVERY_FILE_TYPE_UNSUPPORTED";
    throw error;
  }
  return extension === "jpeg" ? "jpg" : extension;
}

async function uploadDeliveryFiles(orderId, files) {
  if (!Array.isArray(files) || !files.length || files.length > 5) {
    const error = new Error("请选择 1—5 个交付文件");
    error.code = "DELIVERY_FILES_REQUIRED";
    throw error;
  }
  const validatedFiles = Array.from(files, (input) => {
      if (!input || typeof input !== "object") {
        const error = new Error("交付文件无效，请重新选择文件");
        error.code = "DELIVERY_FILE_INVALID";
        throw error;
      }
      const file = { ...input };
      if (file.fileId && !file.path) {
        if (!file.assetId) {
          const error = new Error("交付文件缺少资产记录，请重新选择文件");
          error.code = "DELIVERY_FILE_INVALID";
          throw error;
        }
        return file;
      }
      if (!file.path || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 20 * 1024 * 1024) {
        const error = new Error("单个交付文件须大于 0 且不超过 20 MB");
        error.code = "DELIVERY_FILE_SIZE_INVALID";
        throw error;
      }
      return { ...file, extension: deliveryExtension(file.name) };
  });
  const uploaded = [];
  const created = [];
  try {
    for (const file of validatedFiles) {
      if (file.fileId && !file.path) {
        uploaded.push({ name: file.name, assetId: file.assetId, fileId: file.fileId });
        continue;
      }
      const prepared = await callMedia({
        action: "prepareUpload", purpose: "ORDER_DELIVERY", scopeId: orderId,
        mimeType: DELIVERY_MIME_BY_EXTENSION[file.extension], sizeBytes: file.size, originalFilename: file.name
      });
      const tracked = { assetId: prepared.assetId, fileId: "" };
      created.push(tracked);
      const result = await wx.cloud.uploadFile({ cloudPath: prepared.cloudPath, filePath: file.path });
      tracked.fileId = result.fileID;
      const committed = await callMedia({ action: "commitUpload", assetId: prepared.assetId, fileId: result.fileID });
      const item = { name: file.name, assetId: prepared.assetId, fileId: committed.fileId || result.fileID };
      uploaded.push(item);
    }
    return uploaded;
  } catch (error) {
    await Promise.all(created.map((item) => callMedia({ action: "cancelUpload", assetId: item.assetId, fileId: item.fileId }).catch(() => null)));
    throw error;
  }
}

function idempotencyKey() {
  return `booking-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

module.exports = {
  createOrder, getOrder, idempotencyKey, isAvailable, listOrders, scheduleFromSegments, toClientOrder,
  transitionOrder, uploadDeliveryFiles, getProviderFunds, refreshPayment, createPayment, getDeliveryDownload, getReferenceDownload
};
