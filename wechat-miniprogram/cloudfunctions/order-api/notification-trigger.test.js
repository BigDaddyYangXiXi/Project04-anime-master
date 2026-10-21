const test = require('node:test');
const assert = require('node:assert/strict');
const { notificationRequest: request, triggerNotification: trigger } = require('./notification-trigger');
const { verify } = require('./notification-rpc');
const secret = 'a'.repeat(64), buyer = 'acct_' + 'b'.repeat(32), provider = 'acct_' + 'c'.repeat(32);
const result = { id: 'ord_' + 'd'.repeat(32), buyerId: buyer, providerId: provider, viewerRole: 'BUYER', stage: 'REQUESTED',
  requirement: 'private-sentinel', events: [{ id: 'evt_' + 'e'.repeat(32), event: 'ORDER_CREATED', actorId: buyer, toStage: 'REQUESTED' }] };

test('creation and transitions notify the opposite participant using only persisted identifiers', async () => {
  assert.equal(request('createOrder', result).recipientAccountId, provider);
  const response = { ...result, viewerRole: 'PROVIDER', stage: 'CONTACTING',
    events: [{ ...result.events[0], event: 'PROVIDER_INTERESTED', actorId: provider, toStage: 'CONTACTING' }] };
  assert.equal(request('transitionOrder', response, 'PROVIDER_INTERESTED').recipientAccountId, buyer);
  let calls = 0;
  const sent = await trigger('createOrder', result, undefined, secret, async signed => {
    calls++; const body = verify(signed, ['dispatch'], secret);
    assert.deepEqual(Object.keys(body.payload).sort(), ['eventId', 'orderId', 'recipientAccountId']);
    assert.equal(JSON.stringify(body).includes('private-sentinel'), false);
    return { result: { ok: true, data: { status: 'ACKNOWLEDGED', recorded: true } } };
  });
  assert.equal(calls, 1); assert.equal(sent.status, 'ACKNOWLEDGED');
});

test('reads, unrelated actors, outdated mutation responses and invalid identifiers do not trigger', () => {
  assert.equal(request('getOrder', result), null);
  assert.equal(request('transitionOrder', result, 'BUYER_SUPPLEMENTS'), null);
  assert.equal(request('createOrder', { ...result, viewerRole: 'PROVIDER' }), null);
  assert.equal(request('createOrder', { ...result, providerId: buyer }), null);
  assert.equal(request('createOrder', { ...result, id: 'demo' }), null);
  assert.equal(request('createOrder', { ...result, stage: 'COMPLETED' }), null);
});

test('failed trigger never throws into an already successful order operation or blindly retries', async () => {
  let calls = 0;
  const value = await trigger('createOrder', result, undefined, secret, async () => { calls++; throw Error('private transport'); });
  assert.deepEqual(value, { status: 'UNCONFIRMED' }); assert.equal(calls, 1);
  assert.deepEqual(await trigger('createOrder', result, undefined, secret, async () => ({ result: { ok: false } })), { status: 'UNCONFIRMED' });
});
