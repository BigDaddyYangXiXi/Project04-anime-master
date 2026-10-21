const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { main } = require('./prepare-tax-profile-review-cli');
const env = { ORDER_MYSQL_CONFIG: JSON.stringify({ host:'test.invalid',database:'test',user:'reviewer',password:'synthetic' }),
  TAX_PROFILE_CONFIG: JSON.stringify({ encryptionKeyHex:'ab'.repeat(32),keyId:'test-key' }) };
test('prepare uses verified TLS, delegates scope and closes pool; output excludes private data', async () => {
  let closed = false;
  const input = { scope:{submissionId:'a'.repeat(32)}, classification:{taxpayerReference:'opaque'} };
  const result = await main(['--prepare','private.json'], env, {
    readFileSync: () => JSON.stringify(input),
    createPool: options => {
      assert.deepEqual(options.ssl,{rejectUnauthorized:true,verifyIdentity:true});
      assert.equal(options.multipleStatements,false);
      return { end:async () => { closed = true; } };
    },
    prepare: async (pool,scope,classification,encryption) => {
      assert.deepEqual(scope,input.scope); assert.deepEqual(classification,input.classification);
      assert.equal(encryption.key.length,32);
      return {profileVersionId:'a'.repeat(32),status:'PENDING',privatePayload:'must-not-output'};
    }
  });
  assert.deepEqual(result,{profileVersionId:'a'.repeat(32),status:'PENDING'}); assert.equal(closed,true);
});
test('invalid credentials or conflicting keys fail before connecting', async () => {
  for (const bad of [{...env,TAX_PROFILE_CONFIG_B64:'e30='},{...env,TAX_PROFILE_CONFIG:'{}'},
    {...env,ORDER_MYSQL_CONFIG:JSON.stringify({host:'x',database:'x',user:'am_payment',password:'x'})}]) {
    await assert.rejects(main(['--prepare','unused'],bad,{createPool:()=>assert.fail('must not connect')}),/TAX_PREPARE_CONFIG_REQUIRED/);
  }
});
test('database failures close connection and CLI errors do not expose secrets', async () => {
  let closed = false;
  await assert.rejects(main(['--prepare','private.json'],env,{
    readFileSync:()=>'{"scope":{},"classification":{}}',
    createPool:()=>({end:async()=>{closed=true;}}),prepare:async()=>{throw Error('synthetic-private-error');}
  }),/synthetic-private-error/);
  assert.equal(closed,true);
  const result=spawnSync(process.execPath,[require.resolve('./prepare-tax-profile-review-cli'),'--prepare','unused'],{
    env:{...process.env,ORDER_MYSQL_CONFIG:'synthetic-private-error'},encoding:'utf8'
  });
  assert.equal(result.status,1); assert.equal(result.stdout,''); assert.equal(result.stderr.trim(),'TAX_PREPARE_FAILED');
});
test('binding uses operator environment and independent key; returns only internal references', async () => {
  let closed=false;
  const configured={...env,TAX_REVIEW_OPERATOR_ID:'finance-owner',TAX_IDENTITY_INDEX_KEY_HEX:'cd'.repeat(32)};
  const input={scope:{submissionId:'a'.repeat(32)},verification:{identityVerified:true,evidenceReference:'evidence',
    verifiedIdentity:{jurisdiction:'TEST',identifierType:'TEST',identifier:'PRIVATE_SYNTHETIC'}}};
  const result=await main(['--bind','private.json'],configured,{
    readFileSync:()=>JSON.stringify(input),createPool:()=>({end:async()=>{closed=true;}}),
    bind:async(pool,scope,verification,encryption,indexKey)=>{
      assert.equal(verification.operator,'finance-owner');
      assert.deepEqual(verification.verifiedIdentity,input.verification.verifiedIdentity);
      assert.equal(indexKey.equals(encryption.key),false);
      return {submissionId:scope.submissionId,taxpayerReference:'b'.repeat(32),identifier:'PRIVATE_SYNTHETIC'};
    }
  });
  assert.deepEqual(result,{submissionId:'a'.repeat(32),taxpayerReference:'b'.repeat(32)}); assert.equal(closed,true);
  for (const bad of [{...configured,TAX_REVIEW_OPERATOR_ID:''},{...configured,TAX_IDENTITY_INDEX_KEY_HEX:'ab'.repeat(32)}]) {
    await assert.rejects(main(['--bind','private.json'],bad,{readFileSync:()=>JSON.stringify(input),createPool:()=>assert.fail('must not connect')}),/CONFIG_REQUIRED/);
  }
  await assert.rejects(main(['--bind','private.json'],configured,{readFileSync:()=>JSON.stringify({...input,verification:{...input.verification,operator:'override'}}),createPool:()=>assert.fail('must not connect')}),/CONFIG_REQUIRED/);
});
