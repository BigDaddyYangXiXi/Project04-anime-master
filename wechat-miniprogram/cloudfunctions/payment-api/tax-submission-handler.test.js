const test = require('node:test');
const assert = require('node:assert/strict');
const { submitOwnTaxProfile: submit } = require('./tax-submission-handler');
const caller = { WX_OPENID: 'signed-user', WX_APPID: 'fixture-app' };
const config = { appid: 'fixture-app', taxWithholdingEntityId: 'fixture-company', taxSubmissionEnabled: true };
const event = { action: 'submitTaxProfile' };
const privateConfig = { encryptionKeyHex: '1'.repeat(64), keyId: 'fixture-key', noticeVersion: 'fixture-notice' };
const env = { TAX_PROFILE_CONFIG: JSON.stringify(privateConfig) };
const noDatabase = { execute: () => { throw Error('must not query'); } };
test('missing signed identity and client identity or decision overrides are rejected before database', async () => {
  await assert.rejects(submit(noDatabase, event, {}, config, env), /AUTH_CONTEXT_MISSING/);
  await assert.rejects(submit(noDatabase, event, {...caller, WX_APPID:'other'}, config, env), /AUTH_CONTEXT_MISSING/);
  for (const override of [{providerId:'other'},{withholdingEntityId:'other'},{reviewStatus:'VERIFIED'},{taxpayerReference:'other'}, {taxResidency:'RESIDENT'}]) {
    await assert.rejects(submit(noDatabase, {...event,...override}, caller, config, env), /SUBMISSION_INVALID/);
  }
});
test('closed collection, missing private setup and reuse of payment key all fail before querying', async () => {
  await assert.rejects(submit(noDatabase,event,caller,{...config,taxSubmissionEnabled:false},env), /NOT_ENABLED/);
  for (const value of [{}, {TAX_PROFILE_CONFIG:'bad'}, {...env,TAX_PROFILE_CONFIG_B64:'e30='}]) {
    await assert.rejects(submit(noDatabase,event,caller,config,value), /NOT_CONFIGURED/);
  }
  await assert.rejects(submit(noDatabase,event,caller,{...config,apiV3Key:Buffer.from(privateConfig.encryptionKeyHex,'hex')},env), /NOT_CONFIGURED/);
});
test('account identity lookup uses only signed openid and absent active provider cannot submit', async () => {
  await assert.rejects(submit({execute:async(sql,params)=>{assert.deepEqual(params,['signed-user']);return [[]];}},event,caller,config,env), /ACCOUNT_NOT_FOUND/);
});
