const test = require('node:test');
const assert = require('node:assert/strict');
const { readTaxProfileStatus: read } = require('./tax-status-read');
const caller = { WX_APPID: 'wx_fixture', WX_OPENID: 'signed-user' };
const config = { appid: 'wx_fixture', taxWithholdingEntityId: 'fixture-company' };
test('status response includes no private identity, taxpayer key or verification evidence', async () => {
  const pool = { execute: async (sql, params) => {
    assert.deepEqual(params, ['wx_fixture', 'fixture-company', 'signed-user']);
    return [[{ owner_id: 'private-owner', submission_id: 'submission', profile_version_id: 'version',
      review_status: 'VERIFIED', entity_type: 'INDIVIDUAL', tax_residency: 'RESIDENT',
      encrypted_payload: 'private-ciphertext', taxpayer_reference: 'private-reference', review_reference: 'private-evidence' }]];
  } };
  const result = await read(pool, { action: 'getTaxProfileStatus' }, caller, config);
  assert.equal(result.status, 'VERIFIED'); assert.doesNotMatch(JSON.stringify(result), /private-/);
  assert.equal(result.payable, undefined);
});
test('client identity overrides and missing signed caller fail before querying', async () => {
  const pool = { execute: () => { throw Error('must not query'); } };
  for (const extra of [{ providerId: 'other' }, { taxpayerReference: 'other' }, { submissionId: 'other' }]) {
    await assert.rejects(read(pool, { action: 'getTaxProfileStatus', ...extra }, caller, config), /INPUT_INVALID/);
  }
  await assert.rejects(read(pool, { action: 'getTaxProfileStatus' }, {}, config), /AUTH_CONTEXT_MISSING/);
  await assert.rejects(read(pool, { action: 'getTaxProfileStatus' }, { ...caller, WX_APPID: 'other' }, config), /AUTH_CONTEXT_MISSING/);
  await assert.rejects(read(pool, { action: 'getTaxProfileStatus' }, caller, { appid: config.appid }), /NOT_CONFIGURED/);
});
test('no active provider is distinct from provider with no submission', async () => {
  await assert.rejects(read({ execute: async () => [[]] }, { action: 'getTaxProfileStatus' }, caller, config), /ACCOUNT_NOT_FOUND/);
  assert.deepEqual(await read({ execute: async () => [[{ owner_id: 'provider' }]] }, { action: 'getTaxProfileStatus' }, caller, config), { status: 'NOT_SUBMITTED' });
});
