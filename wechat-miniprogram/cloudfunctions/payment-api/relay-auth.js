const crypto = require('node:crypto');
function reject() { const error = new Error('PAYMENT_RELAY_REJECTED'); error.code = error.message; throw error; }
function verifyRelayRequest(method, event, body, config, now) {
  if (typeof event.authorization !== 'string' || event.authorization.length > 1500) reject();
  const match = /^WECHATPAY2-SHA256-RSA2048 mchid="([0-9]{1,32})",nonce_str="([a-f0-9]{32})",signature="([A-Za-z0-9+/]{342}==)",timestamp="([0-9]{10})",serial_no="([A-Fa-f0-9]{1,64})"$/.exec(event.authorization);
  if (!match || !Number.isSafeInteger(now) || Math.abs(Math.floor(now / 1000) - Number(match[4])) > 30
    || match[1] !== config.platformMchid || match[5] !== config.merchantSerial
    || !/^PUB_KEY_ID_\d{1,100}$/.test(config.wechatPublicKeyId || '')) reject();
  let key;
  try { key = crypto.createPublicKey(config.merchantPublicKey); } catch { reject(); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength !== 2048) reject();
  const message = `${method}\n${event.path}\n${match[4]}\n${match[2]}\n${body}\n`;
  if (!crypto.verify('RSA-SHA256', Buffer.from(message), { key, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(match[3], 'base64'))) reject();
  // Hash canonical signed content, not base64 spelling: unused padding bits must not bypass deduplication.
  return crypto.createHash('sha256').update(`${match[1]}\n${match[5]}\n${message}`).digest('hex');
}
module.exports = { verifyRelayRequest };
