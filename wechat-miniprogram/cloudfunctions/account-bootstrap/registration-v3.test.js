const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb } = require('./registration-test-db');
const { registerByPhone, phoneFingerprint } = require('./phone-core');
const { readSession, registerAccount, NOTICE_VERSION } = require('./identity-core');
const { nicknameKey, normalizeUsername } = require('./account-names');
const key = 'test-phone-fingerprint-key-with-32-chars';
const context = { APPID: 'app', OPENID: 'one' };
const input = { nickname: '桃桃', username: 'taotao_01', acceptedNotice: true, noticeVersion: NOTICE_VERSION };
const phone = { phoneNumber: '13800138000', countryCode: '86' };
const register = (db, c = context, i = input, p = phone) => registerByPhone(db, c, i, p, key, 1234);

test('profile edits use the same canonical nickname uniqueness rule', async () => {
  const { handleAccount } = require('../account-api/account-core');
  const db=createDb({accounts:[{id:'one',nickname:'甲',nickname_key:nicknameKey('甲'),status:'ACTIVE',version:1,updated_at:1},
    {id:'two',nickname:'ＴＡＯ桃',nickname_key:nicknameKey('ＴＡＯ桃'),status:'ACTIVE',version:1,updated_at:1}],wechat_identities:[{account_id:'one',open_id:'one'}]});
  await assert.rejects(handleAccount(db,{action:'updateMine',expectedVersion:1,nickname:'tao桃',avatarAssetId:null},{OPENID:'one'},1234,{reviewNickname:async()=>{}}),{code:'NICKNAME_TAKEN'});
  assert.equal(db.writes.length,0);
});

test('names normalize width, case and repeated spaces; username boundaries reject ambiguous input', () => {
  assert.equal(nicknameKey('ＡＢＣ  桃'), nicknameKey('abc 桃'));
  for (const value of ['a', 'a'.repeat(13), '英文字母', 'John Smith', 'John\n', '全角！']) assert.throws(() => normalizeUsername(value), { code: 'INVALID_USERNAME' });
  for (const value of ['Li', 'John', 'John.Smith', '1Ab!', '_Name_', 'A__B', 'a'.repeat(12)]) assert.equal(normalizeUsername(value), value);
});
test('every ASCII English punctuation is accepted and preserved',()=>{for(let code=33;code<=126;code++){const name='A'+String.fromCharCode(code);assert.equal(normalizeUsername(name),name);}});

test('no verified phone means no account, UID or identity writes', async () => {
  const db = createDb(); await assert.rejects(registerAccount(db, context, input), { code: 'PHONE_AUTH_REQUIRED' }); assert.equal(db.writes.length, 0);
});
test('completed registration gets a random 12-digit UID; public session excludes private fields', async () => {
  const db = createDb(); const session = await register(db);
  assert.equal(session.registered, true); assert.match(session.account.uid, /^[1-9][0-9]{11}$/);
  assert.equal(db.tables.accounts[0].status, 'ACTIVE');
  assert.equal(db.tables.account_phone_identities[0].verification_method, 'REALTIME');
  assert.equal(JSON.stringify(db.tables).includes(phone.phoneNumber), false);
  assert.equal(JSON.stringify(session).includes('phone_fingerprint'), false);
  assert.equal(Object.hasOwn(session.account, 'username'), false);
  assert.deepEqual(session.roles, ['BUYER', 'PROVIDER']);
});
test('duplicate nickname, username or phone cannot create another active account', async () => {
  const db = createDb(); await register(db);
  for (const [i, p, code] of [
    [{ ...input, username: 'second01' }, { phoneNumber: '13900139000', countryCode: '86' }, 'NICKNAME_TAKEN'],
    [{ ...input, nickname: '另一位' }, { phoneNumber: '13900139000', countryCode: '86' }, 'USERNAME_TAKEN'],
    [{ ...input, nickname: '另一位', username: 'second01' }, phone, 'PHONE_ALREADY_REGISTERED']
  ]) await assert.rejects(register(db, { ...context, OPENID: 'two' }, i, p), { code });
  assert.equal(db.tables.accounts.length, 1);
});
test('interrupted registration remains pending, cannot log in, resumes with same UID', async () => {
  let interrupted = true;
  const db = createDb({}, ({ table, operation }) => { if (interrupted && table === 'account_roles' && operation === 'insert') throw Error('network interrupted'); });
  await assert.rejects(register(db), /network interrupted/);
  const uid = db.tables.accounts[0].uid;
  assert.equal(db.tables.accounts[0].status, 'PENDING'); assert.equal((await readSession(db, context)).registered, false);
  interrupted = false; const result = await register(db);
  assert.equal(result.account.uid, uid); assert.equal(result.registered, true);
});
test('concurrent names claim only one account and never activates loser', async () => {
  const db = createDb();
  const outcomes = await Promise.allSettled([register(db), register(db, { ...context, OPENID: 'two' }, { ...input, username: 'second01' }, { phoneNumber: '13900139000', countryCode: '86' })]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(db.tables.accounts.filter(a => a.status === 'ACTIVE').length, 1);
});
test('phone saved before interrupted WeChat binding can resume by its deterministic owner only', async () => {
  let interrupted = true;
  const db = createDb({}, ({table, operation}) => { if(interrupted && table === 'wechat_identities' && operation === 'insert') throw Error('interrupted'); });
  await assert.rejects(register(db), /interrupted/);
  assert.equal(db.tables.accounts[0].status, 'PENDING');
  assert.equal(db.tables.account_phone_identities.length, 1);
  await assert.rejects(register(db, {...context, OPENID:'other'}), {code:'PHONE_ALREADY_REGISTERED'});
  interrupted = false; assert.equal((await register(db)).registered, true);
});
test('authorized legacy reset reuses account primary key and receives numeric UID after phone proof', async () => {
  const db = createDb({ accounts: [{ id: 'legacy', uid: 'AM_LEGACY', nickname: '旧账号', status: 'PENDING', registration_version: 0, version: 4 }], wechat_identities: [{ account_id: 'legacy', open_id: 'one' }] });
  const result = await register(db); assert.equal(result.account.id, 'legacy'); assert.match(result.account.uid, /^\d{12}$/); assert.equal(db.tables.accounts.length, 1);
});

test('registered identity cannot pretend a different authorized phone is bound', async()=>{const db=createDb();await register(db);await assert.rejects(register(db,context,input,{phoneNumber:'13500135000',countryCode:'86'}),{code:'ACCOUNT_PHONE_ALREADY_BOUND'});});
