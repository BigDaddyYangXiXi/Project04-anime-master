const test = require("node:test");
const assert = require("node:assert/strict");
const { loginByPhone, maskPhone, phoneFingerprint, registerByPhone } = require("./phone-core");

const KEY = "test-phone-fingerprint-key-with-32-chars";

function mockDb({ phoneAccountId = null, phoneConflictAccountId = null, wechatAccountId = null, wechatConflictAccountId = null } = {}) {
 const {createDb}=require('./registration-test-db');
 const db=createDb({accounts:phoneAccountId?[{id:phoneAccountId,uid:'AM_PHONE',nickname:'手机号用户',status:'ACTIVE',version:1}]:[],wechat_identities:wechatAccountId?[{account_id:wechatAccountId,open_id:'openid-1'}]:[],account_phone_identities:phoneAccountId?[{account_id:phoneAccountId,phone_fingerprint:phoneFingerprint('13800138000',KEY),phone_masked:'138****8000'}]:[]},({table,operation,values,tables})=>{
  if(operation==='insert'&&table==='account_phone_identities'&&phoneConflictAccountId) tables[table]=[{...values,account_id:phoneConflictAccountId}];
  if(operation==='insert'&&table==='wechat_identities'&&wechatConflictAccountId) tables[table]=[{...values,account_id:wechatConflictAccountId}];
 });
 db.state={writes:db.writes,get wechatAccountId(){return db.tables.wechat_identities[0]?.account_id;}};
 return db;
}

test("手机号只生成带密钥指纹和脱敏展示值", () => {
  const fingerprint = phoneFingerprint("+86 138-0013-8000", KEY);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes("13800138000"), false);
  assert.equal(maskPhone("13800138000"), "138****8000");
  assert.throws(() => phoneFingerprint("13800138000", "short"), (error) => error.code === "PHONE_IDENTITY_NOT_CONFIGURED");
});

test("已验证手机号可登录并绑定当前微信身份", async () => {
  const db = mockDb({ phoneAccountId: "acct_phone" });
  const result = await loginByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { phoneNumber: "13800138000", countryCode: "86" }, KEY, 1234);
  assert.equal(result.account.id, "acct_phone");
  assert.equal(result.phoneMasked, "138****8000");
  assert.equal(db.state.wechatAccountId, "acct_phone");
});

test("未注册手机号不能静默创建账号", async () => {
  const db = mockDb();
  await assert.rejects(
    () => loginByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { phoneNumber: "13800138000", countryCode: "86" }, KEY),
    (error) => error.code === "ACCOUNT_NOT_REGISTERED"
  );
  assert.equal(db.state.writes.length, 0);
});

test("手机号注册创建账号后只保存指纹和脱敏号码", async () => {
  const db = mockDb();
  const result = await registerByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, {
    nickname: "桃桃", acceptedNotice: true, username: "taotao01", noticeVersion: "account-use-v5", verificationMethod: "REALTIME"
  }, { phoneNumber: "13800138000", countryCode: "86" }, KEY, 1234);
  const phoneWrite = db.state.writes.find((item) => item.table === "account_phone_identities").value;
  assert.equal(result.registered, true);
  assert.equal(phoneWrite.phone_masked, "138****8000");
  assert.equal(phoneWrite.country_code, "86");
  assert.equal(phoneWrite.verification_method, "REALTIME");
  assert.equal(JSON.stringify(phoneWrite).includes("13800138000"), false);
});

test("客户端不能把官方实时手机号验证伪装成 FAST", async () => {
  const db = mockDb();
  await registerByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, {
    nickname: "桃桃", acceptedNotice: true, username: "taotao01", noticeVersion: "account-use-v5", verificationMethod: "FAST"
  }, { phoneNumber: "13800138000", countryCode: "86" }, KEY, 1234);
  const phoneWrite = db.state.writes.find((item) => item.table === "account_phone_identities").value;
  assert.equal(phoneWrite.verification_method, "REALTIME");
});

test("手机号唯一键被静默忽略时拒绝虚假绑定成功", async () => {
  const db = mockDb({ phoneConflictAccountId: "acct_other" });
  await assert.rejects(
    () => registerByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, {
      nickname: "桃桃", acceptedNotice: true, username: "taotao01", noticeVersion: "account-use-v5"
    }, { phoneNumber: "13800138000", countryCode: "86" }, KEY, 1234),
    (error) => error.code === "ACCOUNT_PHONE_ALREADY_BOUND"
  );
});

test("微信身份唯一键被静默忽略时拒绝返回错误账号", async () => {
  const db = mockDb({ phoneAccountId: "acct_phone", wechatConflictAccountId: "acct_other" });
  await assert.rejects(
    () => loginByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { phoneNumber: "13800138000", countryCode: "86" }, KEY, 1234),
    (error) => error.code === "ACCOUNT_LINK_CONFLICT"
  );
});

test("已绑定手机号不能重复注册", async () => {
  const db = mockDb({ phoneAccountId: "acct_existing" });
  await assert.rejects(
    () => registerByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { nickname: "桃桃", acceptedNotice: true, username: "taotao01", noticeVersion: "account-use-v5" }, { phoneNumber: "13800138000", countryCode: "86" }, KEY),
    (error) => error.code === "PHONE_ALREADY_REGISTERED"
  );
});
