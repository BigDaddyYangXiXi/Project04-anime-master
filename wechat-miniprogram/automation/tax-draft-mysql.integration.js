const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
const { saveTaxAssessmentDraft: save } = require('../cloudfunctions/payment-api/tax-assessment-store');
const { reviewTaxProfile: review } = require('../scripts/tax-profile-review-core');
const { submitTaxProfile } = require('../cloudfunctions/payment-api/tax-submission-store');
const { prepareTaxProfileReview: prepare } = require('../scripts/prepare-tax-profile-review');
const { bindTaxpayerIdentity: bind } = require('../scripts/bind-taxpayer-identity');
const { main: taxOperatorCommand } = require('../scripts/prepare-tax-profile-review-cli');
const { readTaxProfileStatus } = require('../cloudfunctions/payment-api/tax-status-read');
const { submitOwnTaxProfile } = require('../cloudfunctions/payment-api/tax-submission-handler');
if (process.env.PAYMENT_TEST_MYSQL_PORT !== '33317') throw Error('Explicit isolated test port 33317 required');
const database = 'anime_tax_test_' + crypto.randomBytes(8).toString('hex');
let admin, pool;
before(async () => {
  admin = await mysql.createConnection({ host: '127.0.0.1', port: 33317, user: 'root', password: '' });
  await admin.query(`CREATE DATABASE \`${database}\``);
  pool = mysql.createPool({ host: '127.0.0.1', port: 33317, user: 'root', password: '', database });
  for (const file of ['0001_identity_core.sql', '0044_tax_assessment_drafts.sql', '0045_provider_tax_profile_versions.sql', '0046_tax_profile_reviews.sql', '0047_tax_profile_submissions.sql', '0048_tax_profile_submission_link.sql','0049_taxpayer_identity_mapping.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '../database/mysql', file), 'utf8');
    for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').filter(s => s.trim())) await pool.query(statement);
  }
});
test('signed owner reads only own scoped latest submission; suspended accounts cannot read', async () => {
  for (const person of ['tax-reader-a','tax-reader-b']) {
    await pool.execute("INSERT INTO accounts(id,uid,nickname,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',1,1)", [person,person,person]);
    await pool.execute('INSERT INTO wechat_identities(account_id,open_id,created_at,updated_at) VALUES(?,?,1,1)', [person,person]);
    await pool.execute("INSERT INTO account_roles(account_id,role,enabled_at) VALUES(?,'PROVIDER',1)", [person]);
  }
  const source = await scope({ providerId:'tax-reader-a' });
  const config = { appid:source.appid,taxWithholdingEntityId:source.withholdingEntityId };
  const caller = { WX_APPID:source.appid,WX_OPENID:'tax-reader-a' };
  const event = { action:'getTaxProfileStatus' };
  assert.equal((await readTaxProfileStatus(pool,event,caller,config)).profileVersionId,source.profileVersionId);
  assert.equal((await readTaxProfileStatus(pool,event,{...caller,WX_OPENID:'tax-reader-b'},config)).status,'NOT_SUBMITTED');
  assert.equal((await readTaxProfileStatus(pool,event,caller,{...config,taxWithholdingEntityId:'other'})).status,'NOT_SUBMITTED');
  const next = crypto.randomBytes(16).toString('hex');
  await pool.execute(`INSERT INTO provider_tax_submissions (id,withholding_entity_id,appid,provider_id,encrypted_payload,notice_version,submitted_at)
    VALUES(?,?,?,?,'{}','fixture',2)`,[next,source.withholdingEntityId,source.appid,'tax-reader-a']);
  const latest = await readTaxProfileStatus(pool,event,caller,config);
  assert.equal(latest.status,'SUBMITTED'); assert.equal(latest.submissionId,next);
  await pool.execute("UPDATE accounts SET status='SUSPENDED' WHERE id='tax-reader-a'");
  await assert.rejects(readTaxProfileStatus(pool,event,caller,config),/ACCOUNT_NOT_FOUND/);
});
test('public submission resolves signed account then persists encrypted data with owner status', async () => {
  const provider = 'submission-rpc-user';
  await pool.execute("INSERT INTO accounts(id,uid,nickname,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',1,1)",[provider,provider,provider]);
  await pool.execute('INSERT INTO wechat_identities(account_id,open_id,created_at,updated_at) VALUES(?,?,1,1)',[provider,'submission-rpc-openid']);
  await pool.execute("INSERT INTO account_roles(account_id,role,enabled_at) VALUES(?,'PROVIDER',1)",[provider]);
  const caller={WX_APPID:'rpc-app',WX_OPENID:'submission-rpc-openid'};
  const config={appid:'rpc-app',taxWithholdingEntityId:'rpc-company',taxSubmissionEnabled:true};
  const env={TAX_PROFILE_CONFIG:JSON.stringify({encryptionKeyHex:crypto.randomBytes(32).toString('hex'),keyId:'fixture-key',noticeVersion:'fixture-notice'})};
  const event={action:'submitTaxProfile',submissionId:crypto.randomBytes(16).toString('hex'),entityType:'INDIVIDUAL',legalName:'合成姓名',documentType:'TEST',
    documentNumber:'SYNTHETIC_RPC_ONLY',issuingCountry:'TEST',consent:true,noticeVersion:'fixture-notice'};
  assert.equal((await submitOwnTaxProfile(pool,event,caller,config,env)).verified,false);
  assert.equal((await readTaxProfileStatus(pool,{action:'getTaxProfileStatus'},caller,config)).submissionId,event.submissionId);
  const [[row]]=await pool.execute('SELECT provider_id,encrypted_payload FROM provider_tax_submissions WHERE id=?',[event.submissionId]);
  assert.equal(row.provider_id,provider); assert.doesNotMatch(JSON.stringify(row),/SYNTHETIC_RPC_ONLY/);
  await assert.rejects(submitOwnTaxProfile(pool,{...event,consent:false},caller,config,env),/INVALID/);
});
test('private submission is encrypted, concurrent retries deduplicate and changed identity is rejected', async () => {
  const owner = { submissionId: crypto.randomBytes(16).toString('hex'), withholdingEntityId: 'fixture-company',
    appid: 'fixture-app', providerId: 'fixture-provider' };
  const config = { noticeVersion: 'fixture-notice', encryption: { keyId: 'fixture-key', key: crypto.randomBytes(32) } };
  const data = { entityType: 'INDIVIDUAL', legalName: '合成测试姓名', documentType: 'TEST_ONLY',
    documentNumber: 'SYNTHETIC_NOT_REAL', issuingCountry: 'TEST', consent: true, noticeVersion: config.noticeVersion };
  const results = await Promise.all(Array.from({ length: 10 }, () => submitTaxProfile(pool, owner, data, config)));
  assert.ok(results.every(r => r.status === 'SUBMITTED' && r.verified === false));
  const [rows] = await pool.execute('SELECT encrypted_payload FROM provider_tax_submissions WHERE id=?', [owner.submissionId]);
  assert.equal(rows.length, 1); assert.equal(JSON.stringify(rows).includes(data.documentNumber), false);
  await assert.rejects(submitTaxProfile(pool, owner, { ...data, documentNumber: 'CHANGED' }, config), /CONFLICT/);
  await assert.rejects(submitTaxProfile(pool, { ...owner, providerId: 'foreign' }, data, config), /CONFLICT/);
  await assert.rejects(submitTaxProfile(pool, owner, { ...data, consent: false }, config), /INVALID/);
});
function decision(source, status = 'VERIFIED') {
  return { reviewId: crypto.randomBytes(16).toString('hex'), profileVersionId: source.profileVersionId,
    withholdingEntityId: source.withholdingEntityId, decision: status, evidenceReference: 'fixture-evidence',
    identityAndTaxTreatmentVerified: true };
}
test('operator approval unlocks calculation; revocation blocks it and old approval retries do not revive', async () => {
  const source = await scope();
  await pool.execute("UPDATE provider_tax_profile_versions SET review_status='PENDING' WHERE id=?", [source.profileVersionId]);
  const approval = decision(source);
  const results = await Promise.all(Array.from({ length: 10 }, () => review(pool, approval, 'fixture-operator', 10)));
  assert.ok(results.every(r => r.currentStatus === 'VERIFIED'));
  await save(pool, source, input);
  await review(pool, decision(source, 'REVOKED'), 'fixture-operator', 11);
  assert.equal((await review(pool, approval, 'fixture-operator', 12)).currentStatus, 'REVOKED');
  await assert.rejects(save(pool, { ...source, settlementReference: 'revoked-source' }, input), /REVIEW_REQUIRED/);
  const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM provider_tax_profile_reviews WHERE profile_version_id=?', [source.profileVersionId]);
  assert.equal(row.n, 2);
});
test('conflicting reviewers serialize and cannot both approve and reject one pending profile', async () => {
  const source = await scope();
  await pool.execute("UPDATE provider_tax_profile_versions SET review_status='PENDING' WHERE id=?", [source.profileVersionId]);
  const result = await Promise.allSettled([review(pool, decision(source), 'operator-a', 10),
    review(pool, decision(source, 'REJECTED'), 'operator-b', 10)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(result.find(r => r.status === 'rejected').reason.message, /STATE_CONFLICT/);
});
test('approval requires attestation and database constraints; failure leaves no review history', async () => {
  const source = await scope();
  await pool.execute("UPDATE provider_tax_profile_versions SET review_status='PENDING',tax_residency='UNCONFIRMED' WHERE id=?", [source.profileVersionId]);
  const entry = decision(source);
  await assert.rejects(review(pool, { ...entry, identityAndTaxTreatmentVerified: false }, 'operator', 10), /INPUT_INVALID/);
  await assert.rejects(review(pool, entry, 'operator', 10), e => e.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
  const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM provider_tax_profile_reviews WHERE profile_version_id=?', [source.profileVersionId]);
  assert.equal(row.n, 0);
});
test('review scope and replay parameters are enforced', async () => {
  const source = await scope(); const entry = decision(source, 'REVOKED');
  await assert.rejects(review(pool, { ...entry, withholdingEntityId: 'wrong-company' }, 'operator', 10), /PROFILE_NOT_FOUND/);
  await review(pool, entry, 'operator', 10);
  await assert.rejects(review(pool, { ...entry, evidenceReference: 'changed' }, 'operator', 10), /IDEMPOTENCY_MISMATCH/);
  await assert.rejects(review(pool, entry, 'other-operator', 10), /IDEMPOTENCY_MISMATCH/);
});
after(async () => {
  if (pool) await pool.end();
  if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); await admin.end(); }
});
const input = { period: '2026-09', eligibleMonths: 1, cumulativeIncomeFen: '1000000',
  cumulativeExemptIncomeFen: '0', cumulativeOtherDeductionFen: '0', cumulativeTaxReductionFen: '0', cumulativeWithheldFen: '0' };
async function scope(patch = {}) {
  const value = { withholdingEntityId: 'fixture-company', appid: 'wx_fixture', providerId: 'fixture-provider',
    profileVersionId: crypto.randomBytes(16).toString('hex'), settlementReference: crypto.randomBytes(16).toString('hex'), ...patch };
  await pool.execute(`INSERT INTO provider_tax_submissions (id,withholding_entity_id,appid,provider_id,encrypted_payload,notice_version,submitted_at)
    VALUES(?,?,?,?,'{}','fixture-only',1)`, [value.profileVersionId,value.withholdingEntityId,value.appid,value.providerId]);
  await pool.execute(`INSERT INTO provider_tax_profile_versions
    (id,submission_id,withholding_entity_id,appid,provider_id,taxpayer_reference,entity_type,tax_residency,income_nature,
    review_status,review_reference,reviewed_by,reviewed_at,valid_from_period,valid_through_period,created_at)
    VALUES(?,?,?,?,?,'fixture-person','INDIVIDUAL','RESIDENT','PLATFORM_LABOR',
    'VERIFIED','fixture-review','fixture-reviewer',2,'2026-01','2026-12',1)`,
  [value.profileVersionId, value.profileVersionId, value.withholdingEntityId, value.appid, value.providerId]);
  return value;
}
test('twenty concurrent retries preserve one snapshot and original assessment id', async () => {
  const source = await scope();
  const results = await Promise.all(Array.from({ length: 20 }, () => save(pool, source, input)));
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.ok(results.every(r => r.payable === false && r.calculation.currentWithholdingFen === '9000'));
  const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM tax_assessment_drafts WHERE settlement_reference=?', [source.settlementReference]);
  assert.equal(row.n, 1);
});
test('encrypted submission flows through one pending profile, operator review and tax draft', async () => {
  const owner = { submissionId: crypto.randomBytes(16).toString('hex'), withholdingEntityId: 'fixture-company', appid: 'fixture-app', providerId: 'fixture-provider' };
  const encryption = { keyId: 'fixture-key', key: crypto.randomBytes(32) };
  const config = { encryption, noticeVersion: 'fixture-notice' };
  await submitTaxProfile(pool, owner, { entityType: 'INDIVIDUAL', legalName: '合成姓名', documentType: 'TEST',
    documentNumber: 'SYNTHETIC', issuingCountry: 'TEST', consent: true, noticeVersion: config.noticeVersion }, config);
  const classification = { taxpayerReference: 'verified-fixture-person', taxResidency: 'RESIDENT', incomeNature: 'PLATFORM_LABOR',
    validFromPeriod: '2026-01', validThroughPeriod: '2026-12' };
  await assert.rejects(prepare(pool,owner,classification,encryption),/BINDING_REQUIRED/);
  const operatorEnv={ORDER_MYSQL_CONFIG:JSON.stringify({host:'127.0.0.1',database,user:'root',password:''}),
    TAX_PROFILE_CONFIG:JSON.stringify({keyId:encryption.keyId,encryptionKeyHex:encryption.key.toString('hex')}),
    TAX_REVIEW_OPERATOR_ID:'fixture-operator',TAX_IDENTITY_INDEX_KEY_HEX:crypto.randomBytes(32).toString('hex')};
  // Only the isolated harness replaces TLS transport; real command requires certificate validation.
  const runCommand=(mode,body)=>taxOperatorCommand([mode,'synthetic-private.json'],operatorEnv,{
    readFileSync:()=>JSON.stringify(body),createPool:()=>mysql.createPool({host:'127.0.0.1',port:33317,user:'root',password:'',database})});
  const bindingInput={scope:owner,verification:{identityVerified:true,evidenceReference:'fixture-evidence',
    verifiedIdentity:{jurisdiction:'TEST',identifierType:'TEST_TAX_ID',identifier:'SYNTHETIC'}}};
  const binding=await runCommand('--bind',bindingInput);
  assert.deepEqual(await runCommand('--bind',bindingInput),binding);
  classification.taxpayerReference=binding.taxpayerReference;
  assert.equal((await runCommand('--prepare',{scope:owner,classification})).status,'PENDING');
  const results = await Promise.all(Array.from({ length: 10 }, () => prepare(pool, owner, classification, encryption)));
  assert.equal(new Set(results.map(r => r.profileVersionId)).size, 1);
  assert.ok(results.every(r => r.status === 'PENDING'));
  const source = { ...owner, profileVersionId: results[0].profileVersionId, settlementReference: 'linked-fixture' };
  await assert.rejects(save(pool, source, input), /REVIEW_REQUIRED/);
  await assert.rejects(prepare(pool, { ...owner, providerId: 'other' }, classification, encryption), /NOT_FOUND/);
  await assert.rejects(prepare(pool, owner, { ...classification, taxpayerReference: 'changed' }, encryption), /CONFLICT/);
  await review(pool, decision(source), 'fixture-operator');
  assert.equal((await save(pool, source, input)).calculation.currentWithholdingFen, '9000');
  await review(pool, decision(source, 'REVOKED'), 'fixture-operator');
  assert.equal((await prepare(pool, owner, classification, encryption)).status, 'REVOKED');
});
test('verified tax identity merges concurrent different accounts; key changes and rebindings roll back', async () => {
  const company='mapping-company', encryption={keyId:'mapping-key',key:crypto.randomBytes(32)}, indexKey=crypto.randomBytes(32);
  const verification={identityVerified:true,operator:'reviewer',evidenceReference:'fixture-proof',
    verifiedIdentity:{jurisdiction:'TEST',identifierType:'TEST_TAX_ID',identifier:'SYNTHETIC_SHARED_PERSON'}};
  const owners = Array.from({length:10},(_,i)=>({submissionId:crypto.randomBytes(16).toString('hex'),withholdingEntityId:company,appid:'app-'+i,providerId:'provider-'+i}));
  for (const owner of owners) await submitTaxProfile(pool,owner,{entityType:'INDIVIDUAL',legalName:'合成姓名',documentType:'TEST',documentNumber:'SYNTHETIC',issuingCountry:'TEST',consent:true,noticeVersion:'test'}, {encryption,noticeVersion:'test'});
  await assert.rejects(bind(pool,owners[0],{...verification,identityVerified:false},encryption,indexKey),/INVALID/);
  await assert.rejects(bind(pool,{...owners[0],providerId:'foreign'},verification,encryption,indexKey),/NOT_FOUND/);
  const results=await Promise.all(owners.map(owner=>bind(pool,owner,verification,encryption,indexKey)));
  assert.equal(new Set(results.map(r=>r.taxpayerReference)).size,1);
  assert.deepEqual(await bind(pool,owners[0],verification,encryption,indexKey),results[0]);
  await assert.rejects(bind(pool,owners[0],verification,encryption,crypto.randomBytes(32)),/KEY_CHANGED/);
  await assert.rejects(bind(pool,owners[0],{...verification,verifiedIdentity:{...verification.verifiedIdentity,identifier:'CHANGED'}},encryption,indexKey),/CONFLICT/);
  const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM taxpayer_identities WHERE withholding_entity_id=?',[company]);
  assert.equal(count.n,1);
  const [rows]=await pool.query('SELECT * FROM taxpayer_identities');
  assert.doesNotMatch(JSON.stringify(rows),/SYNTHETIC_SHARED_PERSON/);
  // Same identity in a different withholding entity does not share a tax accumulator key.
  const other={...owners[0],submissionId:crypto.randomBytes(16).toString('hex'),withholdingEntityId:'other-mapping-company'};
  await submitTaxProfile(pool,other,{entityType:'INDIVIDUAL',legalName:'合成姓名',documentType:'TEST',documentNumber:'SYNTHETIC',issuingCountry:'TEST',consent:true,noticeVersion:'test'}, {encryption,noticeVersion:'test'});
  assert.notEqual((await bind(pool,other,verification,encryption,indexKey)).taxpayerReference,results[0].taxpayerReference);
});
test('approval cannot use an unlinked profile', async () => {
  const source = await scope();
  await pool.execute("UPDATE provider_tax_profile_versions SET submission_id=NULL,review_status='PENDING' WHERE id=?", [source.profileVersionId]);
  await assert.rejects(review(pool, decision(source), 'fixture-operator'), /SUBMISSION_MISSING/);
});
test('source reuse cannot switch taxpayer, amount, period or reviewed identity', async () => {
  const source = await scope(); const original = await save(pool, source, input);
  const changed = await scope({ settlementReference: source.settlementReference });
  await pool.execute('UPDATE provider_tax_profile_versions SET taxpayer_reference=? WHERE id=?', ['another-person', changed.profileVersionId]);
  for (const args of [
    [changed, input],
    [source, { ...input, cumulativeIncomeFen: '2000000' }],
    [source, { ...input, period: '2026-10' }]
  ]) await assert.rejects(save(pool, ...args), /IDEMPOTENCY_MISMATCH/);
  assert.equal((await save(pool, source, input)).id, original.id);
});
test('same reference in another withholding entity is independent', async () => {
  const source = await scope(); const first = await save(pool, source, input);
  const other = await scope({ withholdingEntityId: 'company-two', settlementReference: source.settlementReference });
  const second = await save(pool, other, input);
  assert.notEqual(first.id, second.id);
});
test('unreviewed identity is rejected before any database insertion', async () => {
  const source = await scope();
  await pool.execute("UPDATE provider_tax_profile_versions SET review_status='PENDING' WHERE id=?", [source.profileVersionId]);
  await assert.rejects(save(pool, source, { ...input, reviewStatus: 'VERIFIED' }), /REVIEW_REQUIRED/);
  const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM tax_assessment_drafts WHERE settlement_reference=?', [source.settlementReference]);
  assert.equal(row.n, 0);
});
test('input ordering does not affect retries and large amounts survive JSON storage', async () => {
  const source = await scope(), large = { ...input, cumulativeIncomeFen: '9007199254740993' };
  const first = await save(pool, source, large);
  const second = await save(pool, source, Object.fromEntries(Object.entries(large).reverse()));
  assert.deepEqual(first, second);
  assert.equal(second.calculation.cumulativeIncomeFen, large.cumulativeIncomeFen);
});
test('profile cannot be borrowed across provider, app or withholding entity', async () => {
  const source = await scope();
  for (const patch of [{ providerId: 'other' }, { appid: 'other' }, { withholdingEntityId: 'other' }]) {
    await assert.rejects(save(pool, { ...source, ...patch }, input), /PROFILE_NOT_FOUND/);
  }
});
test('expired and revoked profiles stop new calculations without erasing historical drafts', async () => {
  const source = await scope(); const original = await save(pool, source, input);
  await assert.rejects(save(pool, { ...source, settlementReference: 'next-year' }, { ...input, period: '2027-01' }), /PROFILE_NOT_FOUND/);
  await pool.execute("UPDATE provider_tax_profile_versions SET review_status='REVOKED' WHERE id=?", [source.profileVersionId]);
  await assert.rejects(save(pool, { ...source, settlementReference: 'after-revocation' }, input), /REVIEW_REQUIRED/);
  const [[row]] = await pool.execute('SELECT id FROM tax_assessment_drafts WHERE id=?', [original.id]);
  assert.equal(row.id, original.id);
});
test('database disallows verified profiles without evidence or confirmed residency', async () => {
  const source = await scope();
  for (const sql of ["review_reference=NULL", "reviewed_by=' '", 'reviewed_at=NULL',
    "tax_residency='UNCONFIRMED'", "income_nature='UNCONFIRMED'", "valid_through_period='2025-12'"]) {
    await assert.rejects(pool.execute(`UPDATE provider_tax_profile_versions SET ${sql} WHERE id=?`, [source.profileVersionId]),
      error => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
  }
});
