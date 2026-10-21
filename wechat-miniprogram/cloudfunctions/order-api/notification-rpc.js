const crypto = require('node:crypto');
const ENV = 'cloudbase-d2g65rqbvee0bd978';
const ACTIONS = ['dispatch', 'claim', 'recheck', 'record', 'listRecovery'];
function fail() { throw Object.assign(new Error('NOTIFICATION_CALL_REJECTED'), { code: 'NOTIFICATION_CALL_REJECTED' }); }
function sign(body, timestamp, secret) {
  if (typeof secret !== 'string' || !/^[a-f0-9]{64}$/.test(secret)) fail();
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`order-notification-v1\n${ENV}\n${timestamp}\n${body}`).digest('hex');
}
function envelope(action, payload, secret, now = Date.now()) {
  if (!ACTIONS.includes(action) || !Number.isSafeInteger(now) || now <= 0) fail();
  const body = JSON.stringify({ action, payload });
  if (Buffer.byteLength(body) > 4096) fail();
  return { body, timestamp: now, signature: sign(body, now, secret) };
}
function verify(event, allowedActions, secret, now = Date.now()) {
  const { userInfo, tcbContext, ...input } = event || {};
  if (Object.keys(input).some(key => !['body', 'timestamp', 'signature'].includes(key))
    || typeof input.body !== 'string' || Buffer.byteLength(input.body) > 4096
    || !Number.isSafeInteger(input.timestamp) || !Number.isSafeInteger(now)
    || Math.abs(now - input.timestamp) > 30000 || !/^[a-f0-9]{64}$/.test(input.signature || '')) fail();
  if (!crypto.timingSafeEqual(Buffer.from(sign(input.body, input.timestamp, secret), 'hex'), Buffer.from(input.signature, 'hex'))) fail();
  let value; try { value = JSON.parse(input.body); } catch { fail(); }
  if (!value || Object.keys(value).some(key => !['action', 'payload'].includes(key)) || !allowedActions.includes(value.action)) fail();
  return value;
}

module.exports = { ENV, envelope, verify };
