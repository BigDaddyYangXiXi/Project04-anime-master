const crypto = require('node:crypto');
function key(config) {
  if (!config || !/^[A-Za-z0-9_-]{1,64}$/.test(config.keyId || '')
    || !Buffer.isBuffer(config.key) || config.key.length !== 32) throw Error('TAX_ENCRYPTION_CONFIG_INVALID');
  return config.key;
}
function context(scope) {
  if (!scope || ['submissionId', 'withholdingEntityId', 'appid', 'providerId'].some(name =>
    typeof scope[name] !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(scope[name]))) throw Error('TAX_PRIVATE_SCOPE_INVALID');
  return Buffer.from(JSON.stringify(['TAX_SUBMISSION_V1', scope.submissionId, scope.withholdingEntityId, scope.appid, scope.providerId]));
}
function sealTaxPayload(payload, scope, config) {
  const secret = key(config), aad = context(scope);
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > 16384) throw Error('TAX_PRIVATE_PAYLOAD_TOO_LARGE');
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { version: 1, keyId: config.keyId, iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function openTaxPayload(envelope, scope, config) {
  const secret = key(config), aad = context(scope);
  try {
    if (envelope.version !== 1 || envelope.keyId !== config.keyId) throw Error();
    const iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 16384) throw Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', secret, iv);
    decipher.setAAD(aad); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
  } catch { throw Error('TAX_PRIVATE_PAYLOAD_INVALID'); }
}
module.exports = { sealTaxPayload, openTaxPayload };
