const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sealTaxPayload: seal, openTaxPayload: open } = require('./tax-private-payload');
const scope = { submissionId: 'fixture-submission', withholdingEntityId: 'fixture-company', appid: 'fixture-app', providerId: 'fixture-provider' };
const config = { keyId: 'fixture-key', key: crypto.randomBytes(32) };
const payload = { legalName: '合成测试姓名', documentNumber: 'SYNTHETIC-NOT-REAL', entityType: 'INDIVIDUAL' };
test('sensitive fields round trip without plaintext in stored envelope; each encryption is randomized', () => {
  const a = seal(payload, scope, config), b = seal(payload, scope, config);
  assert.deepEqual(open(a, scope, config), payload);
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(JSON.stringify(a).includes(payload.documentNumber), false);
  assert.equal(JSON.stringify(a).includes(payload.legalName), false);
});
test('moving ciphertext to another provider, app, company or submission is rejected', () => {
  const encrypted = seal(payload, scope, config);
  for (const field of Object.keys(scope)) assert.throws(() => open(encrypted, { ...scope, [field]: 'different' }, config), /PAYLOAD_INVALID/);
});
test('tampered data, key version and wrong keys fail without echoing private fields', () => {
  const encrypted = seal(payload, scope, config);
  for (const field of ['iv', 'tag', 'ciphertext']) {
    const data = Buffer.from(encrypted[field], 'base64'); data[0] ^= 1;
    assert.throws(() => open({ ...encrypted, [field]: data.toString('base64') }, scope, config), /PAYLOAD_INVALID/);
  }
  assert.throws(() => open(encrypted, scope, { ...config, key: crypto.randomBytes(32) }), /PAYLOAD_INVALID/);
  assert.throws(() => open(encrypted, scope, { ...config, keyId: 'other' }), /PAYLOAD_INVALID/);
});
test('missing keys and oversized payloads are rejected before storage', () => {
  assert.throws(() => seal(payload, scope, null), /CONFIG_INVALID/);
  assert.throws(() => seal({ value: 'x'.repeat(16385) }, scope, config), /TOO_LARGE/);
});
