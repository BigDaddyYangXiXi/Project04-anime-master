const { ENV, envelope, verify } = require('./notification-rpc');
const { dispatchNotification } = require('./notification-dispatch');

async function sendWithWx(wxCloud, message) {
  try {
    const result = await wxCloud.openapi.subscribeMessage.send(message);
    // wx-server-sdk normalizes successful OpenAPI results to camelCase.
    return { errcode: result?.errCode };
  } catch (error) {
    if (Number.isInteger(error?.errCode) && error.errCode !== 0) return { errcode: error.errCode };
    throw Error('NOTIFICATION_CHANNEL_UNCONFIRMED');
  }
}

async function handle(event, secret, miniprogramState, invoke, send) {
  const { action, payload } = verify(event, ['dispatch', 'recheck'], secret);
  const call = async (action, value) => {
    const response = await invoke(envelope(action, value, secret));
    if (response?.result?.ok !== true) throw Error('NOTIFICATION_PRIVATE_UNAVAILABLE');
    return response.result.data;
  };
  if (action === 'recheck') return (await call('recheck', payload)) === true;
  return dispatchNotification(payload, miniprogramState, {
    claim: value => call('claim', value), recheck: value => call('recheck', value),
    record: (key, status) => call('record', { key, status }), send
  });
}

exports.handle = handle;
exports.sendWithWx = sendWithWx;
exports.main = async event => {
  try {
    if (process.env.SCF_NAMESPACE !== ENV) throw Error('NOTIFICATION_DISABLED');
    // Authenticate before loading SDKs; the private service authenticates each call again.
    const { action } = verify(event, ['dispatch', 'recheck'], process.env.NOTIFICATION_RELAY_KEY);
    if (action === 'dispatch' && process.env.NOTIFICATION_SEND_ENABLED !== 'true') throw Error('NOTIFICATION_DISABLED');
    const cloud = require('@cloudbase/node-sdk').init({ env: ENV, timeout: 12000, retries: 0 });
    let send;
    if (action === 'dispatch') {
      const wxCloud = require('wx-server-sdk');
      wxCloud.init({ env: ENV });
      send = message => sendWithWx(wxCloud, message);
    }
    return { ok: true, data: await handle(event, process.env.NOTIFICATION_RELAY_KEY, process.env.NOTIFICATION_MINIPROGRAM_STATE,
      data => cloud.callFunction({ name: 'order-notification-private', data }),
      send) };
  } catch (_) { return { ok: false, code: 'NOTIFICATION_UNAVAILABLE' }; }
};
