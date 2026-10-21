const test = require("node:test");
const assert = require("node:assert/strict");
const { TEMPLATE_ID, requestOrderSubscription } = require("../miniprogram/services/order-subscription");

test("uses the real template and invokes synchronously in the tap call stack", async () => {
  let invoked = false;
  const pending = requestOrderSubscription({ requestSubscribeMessage(options) {
    invoked = true;
    assert.deepEqual(options.tmplIds, [TEMPLATE_ID]);
    options.success({ [TEMPLATE_ID]: "accept" });
  } });
  assert.equal(invoked, true);
  assert.deepEqual(await pending, { status: "accept" });
});

for (const status of ["reject", "ban", "filter"]) {
  test(`successful callback with ${status} never becomes consent`, async () => {
    const result = await requestOrderSubscription({ requestSubscribeMessage(options) {
      options.success({ errMsg: "requestSubscribeMessage:ok", [TEMPLATE_ID]: status });
    } });
    assert.equal(result.status, status);
  });
}

test("missing template result, API failure and unsupported clients are not consent", async () => {
  assert.equal((await requestOrderSubscription({ requestSubscribeMessage(o) { o.success({}); } })).status, "failed");
  assert.equal((await requestOrderSubscription({ requestSubscribeMessage(o) { o.fail({}); } })).status, "failed");
  assert.equal((await requestOrderSubscription({ requestSubscribeMessage() { throw new Error("offline"); } })).status, "failed");
  assert.equal((await requestOrderSubscription({})).status, "unavailable");
});
