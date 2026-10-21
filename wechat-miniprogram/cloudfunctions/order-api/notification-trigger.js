const { envelope } = require('./notification-rpc');

// Called with handleOrder's successful server result, never a client-supplied order.
function notificationRequest(action, result, requestedEvent) {
  if (!['createOrder', 'transitionOrder'].includes(action) || !result || !Array.isArray(result.events)) return null;
  const latest = result.events[result.events.length - 1];
  const expected = action === 'createOrder' ? 'ORDER_CREATED' : requestedEvent;
  const actorId = result.viewerRole === 'BUYER' ? result.buyerId : result.viewerRole === 'PROVIDER' ? result.providerId : null;
  const recipientAccountId = result.viewerRole === 'BUYER' ? result.providerId : result.buyerId;
  if (!latest || typeof expected !== 'string' || latest.event !== expected || latest.actorId !== actorId
    || latest.toStage !== result.stage || actorId === recipientAccountId
    || !/^ord_[a-f0-9]{32}$/.test(result.id || '') || !/^evt_[a-f0-9]{32}$/.test(latest.id || '')
    || !/^acct_[a-f0-9]{32}$/.test(actorId || '') || !/^acct_[a-f0-9]{32}$/.test(recipientAccountId || '')) return null;
  return { orderId: result.id, eventId: latest.id, recipientAccountId };
}

async function triggerNotification(action, result, requestedEvent, secret, invoke) {
  const request = notificationRequest(action, result, requestedEvent);
  if (!request) return { status: 'SKIPPED' };
  try {
    const reply = await invoke(envelope('dispatch', request, secret));
    if (reply?.result?.ok === true && ['ACKNOWLEDGED', 'REJECTED', 'UNKNOWN', 'DUPLICATE'].includes(reply.result.data?.status)) {
      return { status: reply.result.data.status, recorded: reply.result.data.recorded === true };
    }
  } catch (_) { /* The business transaction already succeeded; never change its result. */ }
  return { status: 'UNCONFIRMED' };
}

module.exports = { notificationRequest, triggerNotification };
