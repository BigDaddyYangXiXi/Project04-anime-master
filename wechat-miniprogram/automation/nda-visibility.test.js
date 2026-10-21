const test = require("node:test"), assert = require("node:assert/strict");
const { providerOrderView } = require("../miniprogram/data/order-presentation");
const { transitionOrder } = require("../miniprogram/data/order-machine");
test("preview provider view hides all private copies without mutating buyer storage", () => {
  const order = { ndaRequired: true, requirement: "secret", referenceImage: "private.png", referenceAssetId: "asset_private",
    location: "private address", supplementNote: "private supplement", bookingDraft: { note: "secret", referenceFile: { path: "private.png" } },
    events: [{ detail: "private event" }] };
  const hidden = providerOrderView(order);
  assert.equal(hidden.requirement, ""); assert.equal(hidden.location, ""); assert.equal(hidden.referenceImage, "");
  assert.equal(hidden.referenceAssetId, null); assert.equal(hidden.supplementNote, "");
  assert.equal(hidden.bookingDraft.note, ""); assert.equal(hidden.bookingDraft.referenceFile, null);
  assert.equal(hidden.events[0].detail, ""); assert.equal(order.requirement, "secret");
  assert.equal(providerOrderView({ ...order, buyerNdaSigned: true }).requirement, "");
  assert.equal(providerOrderView({ ...order, buyerNdaSigned: true, providerNdaSigned: true }).requirement, "secret");
});
test("preview NDA signing precedes communication and final confirmation does not ask for a second signature", () => {
  assert.equal(transitionOrder("REQUESTED", "PROVIDER_INTERESTED", true), "NDA_BUYER_PENDING");
  const order = { ndaFlowVersion: 2, communicationDone: false, buyerNdaSigned: true, providerNdaSigned: true };
  assert.equal(transitionOrder("NDA_PROVIDER_PENDING", "PROVIDER_SIGNS_NDA", true, order), "CONTACTING");
  assert.equal(transitionOrder("CONTACTING", "PROVIDER_ENDS_COMMUNICATION", true, order), "BUYER_FINAL_CONFIRM");
});
