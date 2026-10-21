// Preview-only projection. Production confirmation is enforced atomically by order-api.
const occupiedStages = new Set(["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING", "BUYER_FINAL_CONFIRM", "IN_PRODUCTION", "REVISION_REQUESTED", "DELIVERY_PENDING", "COMPLETED"]);
function segments(order) {
  if (Array.isArray(order.timeSegments)) return order.timeSegments;
  const draft = order.bookingDraft || {};
  if (draft.timeMode === "day") {
    const startsAt = Date.parse(`${draft.date}T00:00:00+08:00`);
    return [{ startsAt, endsAt: startsAt + 86400000 }];
  }
  const source = draft.timeMode === "segments" ? draft.segments || [] : [draft];
  return source.map(item => ({ startsAt: Date.parse(`${item.startDate}T${item.startTime}:00+08:00`),
    endsAt: Date.parse(`${item.endDate}T${item.endTime}:00+08:00`) }));
}
function hasConflict(order, orders) {
  const requested = segments(order);
  return orders.some(other => other.id !== order.id && other.providerId === order.providerId && occupiesSlot(other)
    && segments(other).some(existing => requested.some(item => item.startsAt < existing.endsAt && existing.startsAt < item.endsAt)));
}
function occupiesSlot(order) {
  return occupiedStages.has(order.stage) && !(["NDA_BUYER_PENDING", "NDA_PROVIDER_PENDING"].includes(order.stage)
    && order.ndaFlowVersion === 2 && order.communicationDone === false);
}
module.exports = { hasConflict, occupiesSlot };
