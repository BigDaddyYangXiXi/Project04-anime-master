const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOTICE_VERSION,
  identityKey,
  loginAccount,
  normalizeNickname,
  readSession,
  registerAccount
} = require("./identity-core");
const { toPublicError } = require("./index");

function mockDb({ existingAccountId = null, status = "ACTIVE", roles = ["PROVIDER", "BUYER"] } = {}) {
  const writes = [];
  const generatedId = `acct_${identityKey("app-1", "openid-1").slice(0, 32)}`;
  let boundAccountId = existingAccountId;
  return {
    writes,
    from(table) {
      return {
        upsert(value, options) {
          writes.push({ table, value, options });
          if (table === "wechat_identities") boundAccountId = value.account_id;
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq() {
              if (table === "wechat_identities") {
                return Promise.resolve({ data: boundAccountId ? [{ account_id: boundAccountId }] : [], error: null });
              }
              if (table === "accounts") {
                return Promise.resolve({ data: [{ id: boundAccountId || generatedId, uid: "AM_PUBLIC", nickname: existingAccountId ? "既有用户" : "新用户", avatar_asset_id: null, status, version: "1" }], error: null });
              }
              return Promise.resolve({ data: roles.map((role) => ({ role })), error: null });
            }
          };
        }
      };
    }
  };
}

test("未注册身份查询保持只读", async () => {
  const db = mockDb();
  const result = await readSession(db, { OPENID: "openid-1", APPID: "app-1" });
  assert.deepEqual(result, { registered: false });
  assert.equal(db.writes.length, 0);
});

test("未注册身份不能登录且不会静默建号", async () => {
  const db = mockDb();
  await assert.rejects(
    () => loginAccount(db, { OPENID: "openid-1", APPID: "app-1" }),
    (error) => error.code === "ACCOUNT_NOT_REGISTERED"
  );
  assert.equal(db.writes.length, 0);
});

test("注册建立账号、双角色、用途确认并最后绑定身份", async () => {
  const db = mockDb();
  const result = await registerAccount(db, { OPENID: "openid-1", APPID: "app-1", UNIONID: "union-1" }, {
    nickname: "  桃桃老师  ",
    acceptedNotice: true
  }, 1234);

  assert.equal(result.created, true);
  assert.equal(result.registered, true);
  assert.deepEqual(result.roles, ["BUYER", "PROVIDER"]);
  assert.deepEqual(db.writes.map((item) => item.table), [
    "accounts", "account_roles", "account_registration_consents", "wechat_identities"
  ]);
  assert.equal(db.writes[0].value.nickname, "桃桃老师");
  assert.equal(db.writes[2].value.notice_version, NOTICE_VERSION);
  assert.equal(JSON.stringify(result).includes("openid-1"), false);
  assert.equal(JSON.stringify(result).includes("union-1"), false);
});

test("重复注册复用既有账号且不改写资料", async () => {
  const db = mockDb({ existingAccountId: "acct_existing" });
  const result = await registerAccount(db, { OPENID: "openid-1", APPID: "app-1" }, {
    nickname: "另一个昵称",
    acceptedNotice: true
  }, 5678);
  assert.equal(result.created, false);
  assert.equal(result.account.id, "acct_existing");
  assert.equal(result.account.nickname, "既有用户");
  assert.equal(result.account.version, 1);
  assert.equal(db.writes.length, 0);
});

test("昵称和用途确认由服务端校验", async () => {
  assert.equal(normalizeNickname("  桃桃  "), "桃桃");
  assert.equal(normalizeNickname("👨‍👩‍👧‍👦".repeat(20)), "👨‍👩‍👧‍👦".repeat(20));
  assert.throws(() => normalizeNickname(""), (error) => error.code === "INVALID_NICKNAME");
  assert.throws(() => normalizeNickname("超".repeat(21)), (error) => error.code === "INVALID_NICKNAME");
  assert.throws(() => normalizeNickname({ nickname: "桃桃" }), (error) => error.code === "INVALID_NICKNAME");
  assert.throws(() => normalizeNickname("桃\n桃"), (error) => error.code === "INVALID_NICKNAME");
  await assert.rejects(
    () => registerAccount(mockDb(), { OPENID: "openid-1", APPID: "app-1" }, { nickname: "桃桃" }),
    (error) => error.code === "ACCOUNT_NOTICE_REQUIRED"
  );
});

test("停用账号不能登录", async () => {
  await assert.rejects(
    () => loginAccount(mockDb({ existingAccountId: "acct_existing", status: "SUSPENDED" }), { OPENID: "openid-1", APPID: "app-1" }),
    (error) => error.code === "ACCOUNT_SUSPENDED"
  );
});

test("缺失可信微信上下文时拒绝认证", async () => {
  await assert.rejects(
    () => readSession(mockDb(), { APPID: "app-1" }),
    (error) => error.code === "AUTH_CONTEXT_MISSING"
  );
});

test("公开错误保留稳定错误码并隐藏内部异常", () => {
  assert.deepEqual(toPublicError({ code: "ACCOUNT_NOT_REGISTERED" }), {
    cause: "ACCOUNT_NOT_REGISTERED",
    code: "ACCOUNT_NOT_REGISTERED",
    message: "当前微信身份尚未注册"
  });
  assert.deepEqual(toPublicError(new Error("database credentials leaked")), {
    cause: "UNEXPECTED",
    code: "ACCOUNT_AUTH_FAILED",
    message: "账号请求失败，请稍后重试"
  });
});
