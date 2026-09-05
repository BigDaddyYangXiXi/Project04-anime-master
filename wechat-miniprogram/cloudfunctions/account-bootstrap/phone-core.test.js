const test = require("node:test");
const assert = require("node:assert/strict");
const { loginByPhone, maskPhone, phoneFingerprint, registerByPhone } = require("./phone-core");

const KEY = "test-phone-fingerprint-key-with-32-chars";

function mockDb({ phoneAccountId = null, phoneConflictAccountId = null, wechatAccountId = null, wechatConflictAccountId = null } = {}) {
  const initialFingerprint = phoneAccountId ? phoneFingerprint("13800138000", KEY) : null;
  const state = { phoneAccountId, phoneFingerprint: initialFingerprint, phoneConflictAccountId, wechatAccountId, wechatConflictAccountId, account: null, roles: [], writes: [] };
  return {
    state,
    from(table) {
      return {
        upsert(value) {
          state.writes.push({ table, value });
          if (table === "accounts") state.account = value;
          if (table === "account_roles") state.roles = value;
          if (table === "wechat_identities") state.wechatAccountId = state.wechatConflictAccountId || value.account_id;
          if (table === "account_phone_identities") {
            state.phoneAccountId = state.phoneConflictAccountId || value.account_id;
            state.phoneFingerprint = value.phone_fingerprint;
          }
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq(column, value) {
              if (table === "account_phone_identities") {
                const matches = column === "phone_fingerprint" ? state.phoneFingerprint === value : state.phoneAccountId === value;
                return Promise.resolve({ data: matches ? [{ account_id: state.phoneAccountId, phone_fingerprint: state.phoneFingerprint, phone_masked: "138****8000" }] : [], error: null });
              }
              if (table === "wechat_identities") return Promise.resolve({ data: state.wechatAccountId ? [{ account_id: state.wechatAccountId }] : [], error: null });
              if (table === "accounts") return Promise.resolve({ data: [{ ...(state.account || {}), id: state.wechatAccountId, uid: "AM_PHONE", nickname: state.account && state.account.nickname || "手机号用户", status: "ACTIVE", version: 1 }], error: null });
              if (table === "account_roles") return Promise.resolve({ data: state.roles.length ? state.roles : [{ role: "BUYER" }, { role: "PROVIDER" }], error: null });
              return Promise.resolve({ data: [], error: null });
            }
          };
        }
      };
    }
  };
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
  const result = await loginByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { phoneNumber: "13800138000" }, KEY, 1234);
  assert.equal(result.account.id, "acct_phone");
  assert.equal(result.phoneMasked, "138****8000");
  assert.equal(db.state.wechatAccountId, "acct_phone");
});

test("未注册手机号不能静默创建账号", async () => {
  const db = mockDb();
  await assert.rejects(
    () => loginByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { phoneNumber: "13800138000" }, KEY),
    (error) => error.code === "ACCOUNT_NOT_REGISTERED"
  );
  assert.equal(db.state.writes.length, 0);
});

test("手机号注册创建账号后只保存指纹和脱敏号码", async () => {
  const db = mockDb();
  const result = await registerByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, {
    nickname: "桃桃", acceptedNotice: true, verificationMethod: "REALTIME"
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
    nickname: "桃桃", acceptedNotice: true, verificationMethod: "FAST"
  }, { phoneNumber: "13800138000", countryCode: "86" }, KEY, 1234);
  const phoneWrite = db.state.writes.find((item) => item.table === "account_phone_identities").value;
  assert.equal(phoneWrite.verification_method, "REALTIME");
});

test("手机号唯一键被静默忽略时拒绝虚假绑定成功", async () => {
  const db = mockDb({ phoneConflictAccountId: "acct_other" });
  await assert.rejects(
    () => registerByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, {
      nickname: "桃桃", acceptedNotice: true
    }, { phoneNumber: "13800138000", countryCode: "86" }, KEY, 1234),
    (error) => error.code === "PHONE_ALREADY_REGISTERED"
  );
});

test("微信身份唯一键被静默忽略时拒绝返回错误账号", async () => {
  const db = mockDb({ phoneAccountId: "acct_phone", wechatConflictAccountId: "acct_other" });
  await assert.rejects(
    () => loginByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { phoneNumber: "13800138000" }, KEY, 1234),
    (error) => error.code === "ACCOUNT_LINK_CONFLICT"
  );
});

test("已绑定手机号不能重复注册", async () => {
  const db = mockDb({ phoneAccountId: "acct_existing" });
  await assert.rejects(
    () => registerByPhone(db, { OPENID: "openid-1", APPID: "app-1" }, { nickname: "桃桃", acceptedNotice: true }, { phoneNumber: "13800138000" }, KEY),
    (error) => error.code === "PHONE_ALREADY_REGISTERED"
  );
});
