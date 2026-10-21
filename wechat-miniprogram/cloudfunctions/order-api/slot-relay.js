const crypto = require('node:crypto');
const ENV = 'cloudbase-d2g65rqbvee0bd978';
const PURPOSE = 'order-slot-confirmation-v1';
const PUBLIC_ERRORS = new Set(['PROVIDER_NOT_AVAILABLE', 'PROVIDER_NOT_QUALIFIED', 'ORDER_NOT_FOUND',
  'VERSION_CONFLICT', 'ILLEGAL_TRANSITION', 'INVALID_TIME_SEGMENTS', 'SCHEDULE_CONFLICT', 'SLOT_STORE_NOT_CONFIGURED']);
function fail() { const error = new Error('SLOT_STORE_NOT_CONFIGURED'); error.code = error.message; throw error; }
function key(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== value) fail();
  return bytes;
}
function signature(body, timestamp, secret) {
  return crypto.createHmac('sha256', key(secret)).update(`${PURPOSE}\n${ENV}\n${timestamp}\n${body}`).digest('hex');
}
function envelope(row, next, secret, now = Date.now()) {
  const body = JSON.stringify({ row, next });
  if (!Number.isSafeInteger(now) || Buffer.byteLength(body) > 512 * 1024) fail();
  return { body, timestamp: now, signature: signature(body, now, secret) };
}
async function handle(event, secret, persist, now = Date.now()) {
  if (!event || Object.keys(event).some(k => !['body', 'timestamp', 'signature'].includes(k))
    || typeof event.body !== 'string' || Buffer.byteLength(event.body) > 512 * 1024
    || !Number.isSafeInteger(event.timestamp) || !Number.isSafeInteger(now)
    || Math.abs(now - event.timestamp) > 30000 || !/^[a-f0-9]{64}$/.test(event.signature || '')) fail();
  const expected = signature(event.body, event.timestamp, secret);
  if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(event.signature, 'hex'))) fail();
  const value = JSON.parse(event.body);
  if (!value || !value.row || !value.next || Object.keys(value).some(k => !['row', 'next'].includes(k))) fail();
  // The existing transaction rechecks the version under lock. Replays cannot apply twice.
  await persist(value.row, value.next);
  return { ok: true };
}
async function confirmThroughRelay(row, next, secret, invoke) {
  const payload = envelope(row, next, secret);
  let result;
  try { result = (await invoke(payload))?.result; } catch { fail(); }
  if (result?.ok === true) return;
  const code = PUBLIC_ERRORS.has(result?.code) ? result.code : 'SLOT_STORE_NOT_CONFIGURED';
  const error = new Error(code); error.code = code; throw error;
}
exports.envelope = envelope;
exports.handle = handle;
exports.confirmThroughRelay = confirmThroughRelay;
exports.main = async event => {
  let stage = 'AUTHENTICATE';
  try {
    if (process.env.SCF_NAMESPACE !== ENV) fail();
    // SDK metadata is not identity evidence; authentication remains the exact HMAC envelope.
    const { userInfo, tcbContext, ...request } = event || {};
    return await handle(request, process.env.ORDER_SLOT_RELAY_KEY, async (row, next) => {
      stage = 'PERSIST';
      return require('./slot-runtime')(row, next);
    });
  } catch (error) {
    const cause = ['ETIMEDOUT', 'ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR',
      'ER_TABLEACCESS_DENIED_ERROR', 'PROTOCOL_CONNECTION_LOST'].includes(error?.code) ? error.code
      : stage === 'AUTHENTICATE' && Number.isSafeInteger(event?.timestamp) && Math.abs(Date.now() - event.timestamp) > 30000
        ? 'CLOCK_WINDOW' : 'UNEXPECTED';
    return { ok: false, code: PUBLIC_ERRORS.has(error?.code) ? error.code : 'SLOT_STORE_NOT_CONFIGURED', stage, cause };
  }
};
exports.persist = async (row, next) => {
  if (process.env.SCF_NAMESPACE !== ENV) fail();
  const app = require('@cloudbase/node-sdk').init({ env: ENV, timeout: 12000, retries: 0 });
  return confirmThroughRelay(row, next, process.env.ORDER_SLOT_RELAY_KEY,
    data => app.callFunction({ name: 'order-slot-confirm', data }));
};
