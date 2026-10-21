const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNotificationMessage: build, notificationOutcome: outcome } = require('./notification-message');
const { TEMPLATE_ID } = require('../../miniprogram/services/order-subscription');
const candidate = { orderId: 'ord_' + 'a'.repeat(32), recipientOpenId: 'openid_test-recipient', recipientRole: 'BUYER', stage: 'CONTACTING' };

test('SDK payload uses the configured template and preserves the complete order identity in the return route', () => {
  const message = build(candidate, 'trial');
  assert.equal(message.templateId, TEMPLATE_ID);
  assert.equal(message.miniprogramState, 'trial');
  assert.equal(message.page, `pages/booking-status/index?id=${candidate.orderId}`);
  assert.equal(message.data.character_string1.value, 'a'.repeat(32));
  assert.equal(message.touser, candidate.recipientOpenId);
  assert.equal(message.lang, 'zh_CN');
});

test('all current stages fit official template restrictions without copying private text', () => {
  for (const stage of ['REQUESTED', 'SUPPLEMENT_REQUESTED', 'SUPPLEMENTED', 'CONTACTING', 'NDA_BUYER_PENDING',
    'NDA_PROVIDER_PENDING', 'BUYER_FINAL_CONFIRM', 'IN_PRODUCTION', 'REVISION_REQUESTED', 'DELIVERY_PENDING', 'COMPLETED', 'DECLINED']) {
    const message = build({ ...candidate, stage, title: 'private-sentinel', location: 'private-sentinel', detail: 'private-sentinel' }, 'developer');
    assert.match(message.data.phrase2.value, /^[\u4e00-\u9fff]{1,5}$/);
    assert.equal(message.data.thing3.value, '服务预约');
    assert.equal(JSON.stringify(message).includes('private-sentinel'), false);
    assert.deepEqual(Object.keys(message.data).sort(), ['character_string1', 'phrase2', 'thing3']);
  }
});

test('invalid destinations, unsupported states and unrecognized stages fail before a channel request', () => {
  for (const value of [null, { ...candidate, orderId: candidate.orderId + '&x=1' },
    { ...candidate, recipientOpenId: 'bad\nidentity' }, { ...candidate, stage: 'NEW_STAGE' }, { ...candidate, stage: 'toString' }]) {
    assert.throws(() => build(value, 'formal'), { code: 'NOTIFICATION_MESSAGE_INVALID' });
  }
  for (const state of [undefined, '', 'production']) {
    assert.throws(() => build(candidate, state), { code: 'NOTIFICATION_MESSAGE_INVALID' });
  }
});

test('only explicit channel codes produce definitive results; unknown responses never imply success', () => {
  assert.equal(outcome({ errcode: 0, errmsg: 'ok' }), 'ACKNOWLEDGED');
  for (const errcode of [40001, 40003, 40014, 40037, 43101, 43107, 43108, 45168, 47003]) {
    assert.equal(outcome({ errcode }), 'REJECTED');
  }
  for (const reply of [null, {}, { errcode: '0' }, { errcode: -1 }, { errcode: 99999 }, new Error('timeout')]) {
    assert.equal(outcome(reply), 'UNKNOWN');
  }
});

test('notification return routes match each participant and current order stage', () => {
  for (const [recipientRole, stage, route] of [
    ['BUYER', 'DELIVERY_PENDING', 'fulfillment'], ['BUYER', 'IN_PRODUCTION', 'order-detail'],
    ['BUYER', 'REVISION_REQUESTED', 'order-detail'], ['BUYER', 'COMPLETED', 'order-detail'],
    ['PROVIDER', 'CONTACTING', 'provider-request'], ['PROVIDER', 'NDA_PROVIDER_PENDING', 'provider-task'],
    ['PROVIDER', 'DELIVERY_PENDING', 'provider-request']
  ]) assert.equal(build({ ...candidate, recipientRole, stage }, 'trial').page, `pages/${route}/index?id=${candidate.orderId}`);
  assert.throws(() => build({ ...candidate, recipientRole: 'OUTSIDER' }, 'trial'), { code: 'NOTIFICATION_MESSAGE_INVALID' });
});
