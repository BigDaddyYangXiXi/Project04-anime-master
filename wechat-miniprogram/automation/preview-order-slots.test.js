const test = require("node:test"), assert = require("node:assert/strict");
const { hasConflict } = require("../miniprogram/data/preview-order-slots");
const order = { id: "a", providerId: "provider", stage: "CONTACTING", bookingDraft: { timeMode: "continuous",
  startDate: "2026-10-01", endDate: "2026-10-01", startTime: "09:00", endTime: "10:00" } };
test("preview confirmed orders conflict but other providers and adjacent segments do not", () => {
  const other = { ...order, id: "b", stage: "BUYER_FINAL_CONFIRM" };
  assert.equal(hasConflict(order, [other]), true);
  assert.equal(hasConflict(order, [{ ...other, providerId: "different" }]), false);
  assert.equal(hasConflict(order, [{ ...other, bookingDraft: { ...order.bookingDraft, startTime: "10:00", endTime: "11:00" } }]), false);
});
test("preview NDA before communication does not occupy a slot", () => {
  assert.equal(hasConflict(order, [{ ...order, id: "b", stage: "NDA_BUYER_PENDING", ndaFlowVersion: 2, communicationDone: false }]), false);
  assert.equal(hasConflict(order, [{ ...order, id: "b", stage: "NDA_BUYER_PENDING", communicationDone: true }]), true);
});
