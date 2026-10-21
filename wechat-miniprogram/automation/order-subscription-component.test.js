const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { TEMPLATE_ID } = require('../miniprogram/services/order-subscription');

function mount(api = {}) {
  let definition;
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/components/order-subscription/index.js'), 'utf8'), {
    wx: api, Component(value) { definition = value; },
    require() { return require('../miniprogram/services/order-subscription'); }
  });
  const instance = { properties: { orderId: 'ord_' + 'a'.repeat(32) }, data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); }, ...definition.methods };
  definition.lifetimes.attached.call(instance);
  return { instance, detach() { definition.lifetimes.detached.call(instance); } };
}

test('only a tap opens the native dialog; repeated taps while pending cannot request twice', async () => {
  let requests = 0, callback;
  const { instance } = mount({ requestSubscribeMessage(options) { requests++; callback = options; } });
  assert.equal(requests, 0);
  const pending = instance.subscribe();
  assert.equal(requests, 1); assert.equal(instance.data.pending, true);
  await instance.subscribe(); assert.equal(requests, 1);
  callback.success({ [TEMPLATE_ID]: 'accept' }); await pending;
  assert.equal(instance.data.pending, false); assert.equal(instance.data.resultText, '本次订阅已同意');
});

test('refusal and errors release the control without performing any order operation', async () => {
  for (const status of ['reject', 'ban', 'filter', 'failed']) {
    const { instance } = mount({ requestSubscribeMessage(options) {
      if (status === 'failed') options.fail(); else options.success({ [TEMPLATE_ID]: status });
    } });
    await instance.subscribe(); assert.equal(instance.data.pending, false);
    assert.doesNotMatch(instance.data.resultText, /已同意|已送达/);
    if (status === 'reject') assert.match(instance.data.resultText, /不影响订单操作/);
  }
  const { instance } = mount(); await instance.subscribe(); assert.match(instance.data.resultText, /不支持/);
});

test('invalid local identifiers cannot request authorization and detached views ignore late responses', async () => {
  let callback, requests = 0;
  const control = mount({ requestSubscribeMessage(options) { requests++; callback = options; } });
  control.instance.properties.orderId = 'demo-order'; await control.instance.subscribe(); assert.equal(requests, 0);
  control.instance.properties.orderId = 'ord_' + 'a'.repeat(32);
  const pending = control.instance.subscribe(); control.detach();
  control.instance.setData = () => { throw Error('detached view changed'); };
  callback.success({ [TEMPLATE_ID]: 'accept' }); await pending;
});
