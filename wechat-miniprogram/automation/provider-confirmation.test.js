const test = require("node:test");
const assert = require("node:assert/strict");

let definition;
let modal;
global.Page = (value) => { definition = value; };
global.wx = { showModal: (value) => { modal = value; }, showToast() {} };
require("../miniprogram/pages/provider-request/index");
delete global.Page;
const cloudOrders = require("../miniprogram/services/cloud-orders");
const store = require("../miniprogram/data/v063-store");

function pageForCommunication(ndaChoice) {
  const page = {
    cloudMode: true,
    data: { order: { id: "communication-order", version: 3, stage: "CONTACTING" }, readyConfirm: true, price: 680, timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true, ndaChoice },
    submissions: [],
    runTransition(event, fields) { this.submissions.push({ event, fields }); }
  };
  page.finishCommunication = definition.finishCommunication.bind(page);
  return page;
}

test("provider page submits all confirmations for either NDA choice only after modal confirmation", () => {
  for (const choice of ["yes", "no"]) {
    const page = pageForCommunication(choice);
    page.finishCommunication();
    assert.match(modal.content, /确认成功后占用本次合作时段/);
    modal.success({ confirm: false });
    assert.deepEqual(page.submissions, []);
    page.finishCommunication();
    modal.success({ confirm: true });
    assert.deepEqual(page.submissions, [{ event: "PROVIDER_ENDS_COMMUNICATION", fields: {
      ndaRequired: choice === "yes", timePlaceConfirmed: true, serviceScopeConfirmed: true, amountConfirmed: true
    } }]);
  }
});

test("slot conflict keeps the current order and reports a recoverable error", async (t) => {
  const order = { id: "slot_order", version: 1, stage: "CONTACTING" };
  const page = { orderId: order.id, data: { order, actionPending: false },
    setData(patch) { Object.assign(this.data, patch); },
    renderOrder() { assert.fail("a rejected confirmation must not render a confirmed order"); },
    cloudErrorMessage: definition.cloudErrorMessage };
  t.mock.method(cloudOrders, "transitionOrder", async () => {
    const error = new Error("SCHEDULE_CONFLICT"); error.code = error.message; throw error;
  });
  await definition.runTransition.call(page, "PROVIDER_ENDS_COMMUNICATION", {});
  assert.equal(page.data.order, order);
  assert.equal(page.data.actionPending, false);
  assert.match(page.data.loadError, /时段已有已确认的合作/);
  assert.match(definition.cloudErrorMessage({ code: "SLOT_STORE_NOT_CONFIGURED" }), /暂不可用/);
});

test("provider page keeps incomplete communication out of submission and explains a server rejection", () => {
  const page = pageForCommunication("no");
  page.data.readyConfirm = false;
  modal = null;
  page.finishCommunication();
  assert.equal(modal, null);
  assert.deepEqual(page.submissions, []);
  assert.match(definition.cloudErrorMessage({ code: "COOPERATION_CONFIRMATION_REQUIRED" }), /逐项确认/);
});

test("saving a cloud quote retains time, scope and NDA choices while requiring amount confirmation again", async (t) => {
  const order = { ...structuredClone(store.initialOrders.find((item) => item.stage === "CONTACTING")),
    cloudOrder: true, version: 3, contactFirstCopiedAt: 1000,
    timePlaceConfirmed: false, serviceScopeConfirmed: false, amountConfirmed: false, ndaRequired: null
  };
  const page = { cloudMode: true, orderId: order.id, data: structuredClone(definition.data) };
  for (const [key, value] of Object.entries(definition)) if (typeof value === "function") page[key] = value.bind(page);
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  const runTransition = page.runTransition;
  page.runTransition = (...args) => { page.pending = runTransition(...args); return page.pending; };
  page.renderOrder(order);
  page.setData({ timePlaceConfirmed: true, serviceScopeConfirmed: true, ndaChoice: "yes", amountConfirmed: true });
  const price = page.data.quoteItems[0].finalPrice + 1;
  page.updateQuoteItem({ currentTarget: { dataset: { index: 0 } }, detail: { value: String(price) } });
  assert.equal(page.data.priceCanSave, true);
  t.mock.method(cloudOrders, "transitionOrder", async (id, version, event) => {
    assert.equal(id, order.id);
    assert.equal(version, 3);
    assert.equal(event, "PROVIDER_LOCKS_QUOTE");
    return { ...order, version: 4, priceEdited: true, finalPrice: price,
      serviceItems: [{ ...page.data.quoteItems[0], finalPrice: price }]
    };
  });
  page.savePrice();
  modal.success({ confirm: true });
  await page.pending;
  assert.equal(page.data.order.version, 4);
  assert.equal(page.data.timePlaceConfirmed, true);
  assert.equal(page.data.serviceScopeConfirmed, true);
  assert.equal(page.data.ndaChoice, "yes");
  assert.equal(page.data.amountConfirmed, false);
  assert.equal(page.data.readyConfirm, false);
  assert.equal(page.data.confirmedCount, 3);
  page.toggleConfirm({ currentTarget: { dataset: { key: "amountConfirmed" } } });
  assert.equal(page.data.readyConfirm, true);
});
