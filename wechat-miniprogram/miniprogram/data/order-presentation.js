const { providers, stageLabels } = require("./v063");

const orderGroups = {
  booking: ["REQUESTED", "SUPPLEMENT_REQUESTED", "SUPPLEMENTED", "CONTACTING", "NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "DECLINED"],
  execution: ["IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING"],
  history: ["COMPLETED"]
};

const groupMeta = {
  booking: { label: "预约沟通", tone: "amber" },
  execution: { label: "执行与验收", tone: "berry" },
  history: { label: "历史订单", tone: "green" }
};

function slashDate(value) { return String(value || "").replace(/-/g, "/"); }

function rangeText(startDate, startTime, endDate, endTime) {
  const start = slashDate(startDate);
  const end = slashDate(endDate);
  if (start && start === end) return `${start} ${startTime}—${endTime}`;
  return `${start} ${startTime}—${end} ${endTime}`;
}

function scheduleFor(order) {
  const draft = order.bookingDraft || {};
  if (draft.timeMode === "segments" && Array.isArray(draft.segments) && draft.segments.length) {
    return {
      mode: "多个时段",
      lines: draft.segments.map((item, index) => ({ label: `时段 ${index + 1}`, text: rangeText(item.startDate, item.startTime, item.endDate, item.endTime) }))
    };
  }
  if (draft.timeMode === "day" && draft.date) return { mode: "全天", lines: [{ label: "服务时间", text: `${slashDate(draft.date)} · 全天` }] };
  if (draft.startDate && draft.startTime && draft.endDate && draft.endTime) {
    return { mode: "连续时段", lines: [{ label: "服务时间", text: rangeText(draft.startDate, draft.startTime, draft.endDate, draft.endTime) }] };
  }
  const legacyLines = String(order.time || "待确认时间").split("；").filter(Boolean);
  return {
    mode: legacyLines.length > 1 ? "多个时段" : "服务时间",
    lines: legacyLines.map((text, index) => ({ label: legacyLines.length > 1 ? `时段 ${index + 1}` : "服务时间", text }))
  };
}

function buyerIdentity(order) {
  return { nickname: order.buyer || "未命名用户", uid: order.buyerUid || order.buyerId || "UID 待同步" };
}

function providerIdentity(order) {
  const provider = providers.find((item) => item.id === order.providerId);
  return { nickname: order.provider || provider && provider.name || "未命名服务方", uid: order.providerUid || provider && provider.handle || String(order.providerId || "UID 待同步") };
}

function groupForStage(stage) {
  return Object.keys(orderGroups).find((group) => orderGroups[group].includes(stage)) || "booking";
}

function toneForStage(stage) { return groupMeta[groupForStage(stage)].tone; }

function enrichOrder(order, counterpart) {
  if (counterpart === "buyer") order = providerOrderView(order);
  const schedule = scheduleFor(order);
  return Object.assign({}, order, {
    statusLabel: stageLabels[order.stage] || "订单状态",
    statusTone: toneForStage(order.stage),
    scheduleMode: schedule.mode,
    scheduleLines: schedule.lines,
    counterpart: counterpart === "buyer" ? buyerIdentity(order) : providerIdentity(order)
  });
}

function groupCards(orders) {
  const count = (stages) => orders.filter((order) => stages.includes(order.stage)).length;
  const stageCount = (stage) => orders.filter((order) => order.stage === stage).length;
  return [
    { id: "booking", ...groupMeta.booking, count: count(orderGroups.booking), copy: `待处理 ${stageCount("REQUESTED") + stageCount("SUPPLEMENTED")} · 沟通中 ${stageCount("CONTACTING")} · 待确认 ${stageCount("NDA_BUYER_PENDING") + stageCount("NDA_PROVIDER_PENDING") + stageCount("BUYER_FINAL_CONFIRM")} · 未达成 ${stageCount("DECLINED")}` },
    { id: "execution", ...groupMeta.execution, count: count(orderGroups.execution), copy: `制作中 ${stageCount("IN_PRODUCTION")} · 修改中 ${stageCount("REVISION_REQUESTED")} · 待验收 ${stageCount("DELIVERY_PENDING")}` },
    { id: "history", ...groupMeta.history, count: count(orderGroups.history), copy: `已完成 ${stageCount("COMPLETED")} · 已评价 ${orders.filter((order) => order.stage === "COMPLETED" && order.rating > 0).length}` }
  ];
}

function providerOrderView(order) {
  if (!order || order.ndaRequired !== true || order.buyerNdaSigned && order.providerNdaSigned) return order;
  return { ...order, privateFieldsHidden: true, requirement: "", location: "", referenceAssetId: null,
    referenceImage: "", reference: order.referenceWorkId || "", supplementNote: "",
    bookingDraft: { ...order.bookingDraft, note: "", referenceFile: null },
    events: (order.events || []).map(event => ({ ...event, detail: "" })) };
}

module.exports = { orderGroups, groupMeta, scheduleFor, buyerIdentity, providerIdentity, groupForStage, toneForStage, enrichOrder, groupCards, providerOrderView };
