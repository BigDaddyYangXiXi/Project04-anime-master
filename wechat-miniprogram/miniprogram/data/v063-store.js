const { providers } = require("./v063");
const { transitionOrder } = require("./order-machine");

const KEYS = {
  orders: "anime-master-v063-orders", profile: "anime-master-v063-profile",
  works: "anime-master-v063-works", services: "anime-master-v063-services",
  noticeImage: "anime-master-v063-notice-image", pins: "anime-master-v063-pins",
  fundsAccount: "anime-master-v063-funds-account",
  days: "anime-master-v063-available-days", providerReplyMetrics: "anime-master-v063-provider-reply-metrics",
  accounts: "anime-master-v063-accounts", meDashboard: "anime-master-v063-me-dashboard"
};
const CURRENT_BUYER_ID = "buyer-ayao";
const CURRENT_BUYER_NICKNAME = "阿遥";
const CURRENT_PROVIDER_ID = 1;
const defaultProfile = {
  nickname: "南烛", city: "杭州", cityCode: "330100", bio: "擅长骨相调整、男性角色与轻伤效妆，重视镜头近景的皮肤质感。",
  notice: "请提前提供角色设定；不提供未经授权的隐形眼镜，改期请至少提前 48 小时。",
  serviceName: "角色妆造", servicePrice: 520, serviceDescription: "角色妆面、基础发型调整与拍摄前补妆建议。",
  tags: "男角,骨相调整,伤效妆"
};
const defaultAccounts = {
  buyer: { nickname: CURRENT_BUYER_NICKNAME, avatar: "" },
  provider: { nickname: defaultProfile.nickname, avatar: "" }
};

function seedContact(buyer, index) {
  return { name: buyer, wechat: `coser_${["ayao", "linzhou", "maidong"][index % 3]}`, phone: `1380013800${index}` };
}

function seedDeliveryFiles(stage, career) {
  if (!["DELIVERY_PENDING", "COMPLETED"].includes(stage) || ["妆娘", "毛娘"].includes(career)) return [];
  return [{ name: "交付预览.svg", type: "image/svg+xml", dataUrl: "" }];
}

function makeOrder(id, buyer, stage, index, career = "妆娘") {
  const service = career === "摄影" ? "角色正片摄影" : career === "后期" ? "精选后期" : career === "毛娘" ? "假发修剪与造型" : "角色妆造";
  const price = 520 + index * 80;
  return {
    id, buyerId: index % 4 === 0 ? CURRENT_BUYER_ID : `buyer-seed-${index}`, buyerUid: index % 4 === 0 ? CURRENT_BUYER_ID : `buyer-seed-${index}`, buyer,
    providerId: CURRENT_PROVIDER_ID, providerUid: "@nanzhu_makeup", provider: "南烛", career,
    service,
    city: "杭州", time: `2026/08/${16 + index} 0${6 + index}:30—09:00`,
    requirement: index === 0 ? "夜航者角色妆造，偏冷调舞台妆；需兼顾近景拍摄，底妆持妆至少 8 小时。" : `${buyer}的角色合作需求，已明确时间、地点与交付边界。`,
    reference: index === 0 ? "夜航者 · 角色妆造　AM-MU-3H8KP" : "未提供参考资料",
    referenceImage: "", contact: seedContact(buyer, index), originalPrice: price, finalPrice: price,
    serviceItems: [{ id: `seed-${career}`, name: service, displayPrice: price, finalPrice: price }],
    bookingDraft: {
      providerId: CURRENT_PROVIDER_ID, workId: index === 0 ? "w-mu-2" : "",
      serviceIds: [career === "摄影" ? "photo-day" : career === "毛娘" ? "wig-style" : career === "后期" ? "video-edit" : "makeup"],
      city: "杭州", timeMode: "continuous", date: `2026-08-${16 + index}`,
      startDate: `2026-08-${16 + index}`, startTime: `0${6 + index}:30`, endDate: `2026-08-${16 + index}`, endTime: "09:00",
      segments: [], contact: seedContact(buyer, index), note: index === 0 ? "夜航者角色妆造，偏冷调舞台妆；需兼顾近景拍摄，底妆持妆至少 8 小时。" : `${buyer}的角色合作需求，已明确时间、地点与交付边界。`,
      referenceMode: index === 0 ? "work" : "none", referenceFile: null
    },
    requestedAt: new Date(2026, 7, 16 + index, Math.max(0, 5 + index), 30).getTime(), contactFirstCopiedAt: null,
    priceEdited: false, stage, supplementNote: "", communicationDone: false, ndaRequired: null,
    buyerAgreementConfirmedAt: null, paymentStatus: "UNPAID", paymentRequest: null,
    paidAt: null, paymentTransactionId: "",
    executable: false, buyerNdaSigned: false, providerNdaSigned: false, progress: 20,
    deliveryNote: ["DELIVERY_PENDING", "COMPLETED"].includes(stage) ? (["妆娘", "毛娘"].includes(career) ? "现场服务已完成，请需求方核对约定内容。" : "首轮交付已按约定提交，请需求方检查文件。") : "",
    deliveryFiles: seedDeliveryFiles(stage, career), revisionNote: "", rating: stage === "COMPLETED" ? 5 : 0,
    reviewText: stage === "COMPLETED" ? "沟通清晰，妆面在近景镜头里很干净。" : "", reviewReply: ""
  };
}

const initialOrders = [
  makeOrder("AM-260816-01", "阿遥", "REQUESTED", 0), makeOrder("AM-260817-02", "林昼", "SUPPLEMENTED", 1, "摄影"),
  makeOrder("AM-260818-03", "麦冬", "CONTACTING", 2, "毛娘"), makeOrder("AM-260820-04", "白川", "IN_PRODUCTION", 3, "摄影"),
  makeOrder("AM-260821-05", "小满", "REVISION_REQUESTED", 4, "后期"), makeOrder("AM-260822-06", "闻溪", "IN_PRODUCTION", 5),
  makeOrder("AM-260823-07", "橙子", "DELIVERY_PENDING", 6, "摄影"), makeOrder("AM-260824-08", "山雾", "COMPLETED", 7, "后期"),
  makeOrder("AM-260825-09", "今禾", "DELIVERY_PENDING", 8), makeOrder("AM-260701-10", "星岚", "COMPLETED", 0),
  makeOrder("AM-260705-11", "乌檀", "COMPLETED", 1, "摄影"), makeOrder("AM-260709-12", "照野", "COMPLETED", 2, "毛娘")
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function storageAvailable() { return typeof wx !== "undefined" && wx.getStorageSync; }
function read(key, fallback) {
  if (!storageAvailable()) return clone(fallback);
  const saved = wx.getStorageSync(key);
  return saved && typeof saved === "object" ? saved : clone(fallback);
}
function write(key, value) {
  if (storageAvailable()) wx.setStorageSync(key, value);
  return value;
}
function readStored(key) {
  if (!storageAvailable()) return null;
  const saved = wx.getStorageSync(key);
  return saved && typeof saved === "object" ? clone(saved) : null;
}
function getOrders() { return read(KEYS.orders, initialOrders); }
function saveOrders(orders) { return write(KEYS.orders, orders); }
function findOrder(id) { return getOrders().find((order) => order.id === id) || null; }
function updateOrder(id, patch) {
  let updated = null;
  const orders = getOrders().map((order) => {
    if (order.id !== id) return order;
    updated = Object.assign({}, order, patch);
    return updated;
  });
  saveOrders(orders);
  return updated;
}
function applyEvent(id, event, patch) {
  const order = findOrder(id);
  if (!order) throw new Error(`Order not found: ${id}`);
  return updateOrder(id, Object.assign({}, patch || {}, { stage: transitionOrder(order.stage, event, order.ndaRequired === true, order) }));
}
function calculateProviderReplyMetric(providerId, orders, updatedAt = Date.now()) {
  const samples = orders.filter((order) => order.providerId === providerId
    && Number.isFinite(order.requestedAt) && Number.isFinite(order.contactFirstCopiedAt)
    && order.contactFirstCopiedAt >= order.requestedAt);
  const totalResponseMs = samples.reduce((total, order) => total + order.contactFirstCopiedAt - order.requestedAt, 0);
  return {
    providerId, sampleCount: samples.length, totalResponseMs,
    averageResponseMinutes: samples.length ? Math.max(1, Math.round(totalResponseMs / samples.length / 60000)) : null,
    updatedAt
  };
}
function saveProviderReplyMetric(metric) {
  const metrics = read(KEYS.providerReplyMetrics, {});
  metrics[String(metric.providerId)] = metric;
  write(KEYS.providerReplyMetrics, metrics);
  return metric;
}
function getProviderReplyMetric(providerId) {
  const metrics = read(KEYS.providerReplyMetrics, {});
  return metrics[String(providerId)] || saveProviderReplyMetric(calculateProviderReplyMetric(providerId, getOrders()));
}
function recordContactCopy(id, copiedAt = Date.now()) {
  const order = findOrder(id);
  if (!order) throw new Error(`Order not found: ${id}`);
  if (order.providerId !== CURRENT_PROVIDER_ID || order.stage !== "CONTACTING") return { order, metric: getProviderReplyMetric(order.providerId) };
  if (Number.isFinite(order.contactFirstCopiedAt)) return { order, metric: getProviderReplyMetric(order.providerId) };
  if (!Number.isFinite(order.requestedAt) || copiedAt < order.requestedAt) return { order, metric: getProviderReplyMetric(order.providerId) };
  const updatedOrder = updateOrder(id, { contactFirstCopiedAt: copiedAt });
  return { order: updatedOrder, metric: saveProviderReplyMetric(calculateProviderReplyMetric(order.providerId, getOrders(), copiedAt)) };
}
function getProfile() { return read(KEYS.profile, defaultProfile); }
function saveProfile(profile) { return write(KEYS.profile, profile); }
function getAccount(role) {
  const accounts = read(KEYS.accounts, defaultAccounts);
  const key = role === "provider" ? "provider" : "buyer";
  const fallback = key === "provider" ? { nickname: getProfile().nickname, avatar: getProfile().avatar || "" } : defaultAccounts.buyer;
  return Object.assign({}, fallback, accounts[key] || {});
}
function saveAccount(role, account) {
  const key = role === "provider" ? "provider" : "buyer";
  const accounts = read(KEYS.accounts, defaultAccounts);
  accounts[key] = Object.assign({}, accounts[key] || {}, account);
  write(KEYS.accounts, accounts);
  if (key === "provider") saveProfile(Object.assign({}, getProfile(), {
    nickname: accounts[key].nickname,
    avatar: accounts[key].avatar || ""
  }));
  return accounts[key];
}
function metricValue(metrics, key) {
  return metrics && Number.isFinite(metrics[key]) ? metrics[key] : "—";
}
function getMeDashboard(role) {
  const key = role === "provider" ? "provider" : "buyer";
  const snapshots = readStored(KEYS.meDashboard);
  const snapshot = snapshots && snapshots[key] && typeof snapshots[key] === "object" ? snapshots[key] : null;
  const metrics = snapshot && snapshot.metrics;
  const contentAssets = snapshot && snapshot.contentAssets;
  const account = snapshot && snapshot.account && typeof snapshot.account === "object" ? clone(snapshot.account) : null;
  const assets = [
    { key: "followed", label: "我的关注", value: metricValue(contentAssets, "followed") },
    { key: "liked", label: "我的喜欢", value: metricValue(contentAssets, "liked") },
    { key: "referenced", label: "参考作品", value: metricValue(contentAssets, "referenced") }
  ];
  if (key === "provider") return {
    account,
    assets,
    stats: [
      { label: "历史合作", value: metricValue(metrics, "completedOrders") },
      { label: "作品创作", value: metricValue(metrics, "createdWorks") },
      { label: "作品被参考", value: metricValue(metrics, "workReferences") },
      { label: "作品被收藏", value: metricValue(metrics, "workFavorites") },
      { label: "账号获关注", value: metricValue(metrics, "accountFollowers") }
    ],
    storefrontStatusText: snapshot && snapshot.storefrontStatus === "PUBLISHED" ? "橱窗已公开" : "数据待同步",
    publishedWorksCount: snapshot && Number.isFinite(snapshot.publishedWorksCount) ? snapshot.publishedWorksCount : null
  };
  return {
    account,
    assets,
    stats: [
      { label: "历史合作", value: metricValue(metrics, "completedOrders") },
      { label: "进行中订单", value: metricValue(metrics, "activeOrders") },
      { label: "参考作品", value: metricValue(metrics, "referencedWorks") }
    ]
  };
}
function getWorks() { return read(KEYS.works, providers[0].works); }
function saveWorks(works) { return write(KEYS.works, works); }
function getServices() { return read(KEYS.services, providers[0].services); }
function saveServices(services) { return write(KEYS.services, services); }
function getAvailableDays() { return read(KEYS.days, [16, 18, 20, 22, 25, 27]); }
function saveAvailableDays(days) { return write(KEYS.days, days); }
function getPinnedWorkIds() { return read(KEYS.pins, [providers[0].works[0].id]); }
function savePinnedWorkIds(ids) { return write(KEYS.pins, ids); }
function getNoticeImage() { return read(KEYS.noticeImage, ""); }
function saveNoticeImage(image) { return write(KEYS.noticeImage, image); }
function getFundsAccount() { return read(KEYS.fundsAccount, { withdrawableBalanceCents: 0 }); }

let legacyMediaMigration = null;
let legacyMediaSequence = 0;
function isDataUrl(value) { return typeof value === "string" && /^data:image\/(jpeg|jpg|png);base64,/.test(value); }
function persistDataUrl(value, prefix) {
  const match = value.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (!match || typeof wx === "undefined" || !wx.getFileSystemManager || !wx.env) return Promise.resolve(value);
  const extension = match[1] === "png" ? "png" : "jpg";
  const filePath = `${wx.env.USER_DATA_PATH}/${prefix}-${Date.now()}-${legacyMediaSequence++}.${extension}`;
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath, data: match[2], encoding: "base64",
      success: () => resolve(filePath), fail: reject
    });
  });
}
function migrateLegacyMedia() {
  if (legacyMediaMigration) return legacyMediaMigration;
  const works = getWorks();
  const noticeImage = getNoticeImage();
  const hasLegacyWorks = works.some((work) => (work.imagePreviews || []).some(isDataUrl));
  if (!hasLegacyWorks && !isDataUrl(noticeImage)) return null;
  legacyMediaMigration = Promise.all(works.map(async (work) => {
    const images = await Promise.all((work.imagePreviews || []).map((image, index) =>
      isDataUrl(image) ? persistDataUrl(image, `work-${work.id}-${index}`) : image
    ));
    return Object.assign({}, work, { imagePreviews: images });
  })).then(async (migratedWorks) => {
    const migratedNotice = isDataUrl(noticeImage) ? await persistDataUrl(noticeImage, "notice") : noticeImage;
    saveWorks(migratedWorks);
    saveNoticeImage(migratedNotice);
    return true;
  }).catch((error) => {
    legacyMediaMigration = null;
    throw error;
  });
  return legacyMediaMigration;
}

module.exports = {
  KEYS, CURRENT_BUYER_ID, CURRENT_BUYER_NICKNAME, CURRENT_PROVIDER_ID, defaultProfile, initialOrders, makeOrder,
  getOrders, saveOrders, findOrder, updateOrder, applyEvent, calculateProviderReplyMetric, getProviderReplyMetric, recordContactCopy, getProfile, saveProfile, getAccount, saveAccount,
  getWorks, saveWorks, getServices, saveServices, getAvailableDays, saveAvailableDays, getMeDashboard,
  getPinnedWorkIds, savePinnedWorkIds, getNoticeImage, saveNoticeImage, getFundsAccount, migrateLegacyMedia
};
