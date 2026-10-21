const { buildNotificationMessage, notificationOutcome } = require('./notification-message');

// Server-only orchestration. claim/recheck/record must use the trusted private service;
// send must be the fixed WeChat channel, never a client-provided URL or payload.
async function dispatchNotification(request, miniprogramState, { claim, recheck, send, record }) {
  if (!['developer', 'trial', 'formal'].includes(miniprogramState)) {
    throw Object.assign(new Error('NOTIFICATION_MESSAGE_INVALID'), { code: 'NOTIFICATION_MESSAGE_INVALID' });
  }
  const candidate = await claim(request);
  if (!candidate) return { status: 'DUPLICATE' };
  let status = 'UNKNOWN';
  try {
    const message = buildNotificationMessage(candidate, miniprogramState);
    // Recheck account, current event/version and subscription after the claim commits.
    // Failure is not eligibility. An explicit false means no request was submitted.
    if (await recheck(candidate) === true) status = notificationOutcome(await send(message));
    else status = 'REJECTED';
  } catch (_) {
    // A transport exception can happen after channel acceptance. Never retry send here.
    status = 'UNKNOWN';
  }
  try {
    const recorded = await record(candidate.key, status);
    return { status, recorded: recorded === true };
  } catch (_) {
    // The initial durable claim remains consumed even if this result cannot be saved.
    return { status, recorded: false };
  }
}

module.exports = { dispatchNotification };
