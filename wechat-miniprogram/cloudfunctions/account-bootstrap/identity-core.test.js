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
 const {createDb}=require('./registration-test-db');
 return createDb(existingAccountId?{accounts:[{id:existingAccountId,uid:'AM_PUBLIC',nickname:'既有用户',avatar_asset_id:null,status,version:'1'}],wechat_identities:[{account_id:existingAccountId,open_id:'openid-1'}],account_roles:roles.map(role=>({account_id:existingAccountId,role})),account_phone_identities:[{account_id:existingAccountId,phone_fingerprint:'f'.repeat(64)}]}:{});
}
const verifiedPhone={phone_fingerprint:'f'.repeat(64),phone_masked:'138****8000',country_code:'86'};

test("会话返回本人草稿版本及公开状态，空与未公开不混淆", async () => {
  const db = mockDb({ existingAccountId: "acct_existing" });
  const context = { OPENID: "openid-1", APPID: "app-1" };
  assert.deepEqual((await readSession(db, context)).storefrontState, { draftVersion: 0, hasPublication: false });
  db.tables.provider_catalog_drafts.push({ provider_id: "other", version: 9 });
  assert.equal((await readSession(db, context)).storefrontState.draftVersion, 0);
  db.tables.provider_catalog_drafts.push({ provider_id: "acct_existing", version: "2", payload: "private-content" });
  const draft = await readSession(db, context);
  assert.deepEqual(draft.storefrontState, { draftVersion: 2, hasPublication: false });
  assert.equal(JSON.stringify(draft).includes("private-content"), false);
  db.tables.provider_catalog_publications.push({ provider_id: "acct_existing", publication_version: 1 });
  assert.equal((await readSession(db, context)).storefrontState.hasPublication, true);
  db.tables.provider_catalog_publications.length = 0;
  db.tables.provider_profiles.push({ provider_id: "acct_existing", publish_status: "PUBLISHED" });
  assert.equal((await readSession(db, context)).storefrontState.hasPublication, true);
  assert.equal(db.writes.length, 0);
});

test("橱窗状态读取失败不伪装为空，也不阻断已注册登录", async () => {
  const db = mockDb({ existingAccountId: "acct_existing" });
  const from = db.from;
  db.from = table => {
    if (table === "provider_catalog_drafts") throw Error("unavailable");
    return from(table);
  };
  const result = await readSession(db, { OPENID: "openid-1", APPID: "app-1" });
  assert.equal(result.registered, true);
  assert.equal(result.storefrontState, null);
});

test("未注册身份查询保持只读", async () => {
  const db = mockDb();
  const result = await readSession(db, { OPENID: "openid-1", APPID: "app-1" });
  assert.deepEqual(result, { registered: false });
  assert.equal(db.writes.length, 0);
});

test("旧协议或缺失版本不能注册，拒绝前不写入", async () => {
  for (const noticeVersion of [undefined, "account-use-v1", "forged"]) {
    const db = mockDb();
    await assert.rejects(registerAccount(db, { OPENID: "openid-1", APPID: "app-1" }, { nickname: "合法昵称", acceptedNotice: true, noticeVersion }), { code: "ACCOUNT_NOTICE_OUTDATED" });
    assert.equal(db.writes.length, 0);
  }
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
    acceptedNotice: true, username: "taotao01", noticeVersion: NOTICE_VERSION
  }, 1234, verifiedPhone);

  assert.equal(result.created, true);
  assert.equal(result.registered, true);
  assert.deepEqual(result.roles, ["BUYER", "PROVIDER"]);
  assert.deepEqual(db.writes.map((item) => item.table), [
    "accounts", "account_roles", "account_registration_consents", "account_phone_identities", "wechat_identities", "accounts"
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
    acceptedNotice: true, username: "taotao01", noticeVersion: NOTICE_VERSION
  }, 5678, verifiedPhone);
  assert.equal(result.created, false);
  assert.equal(result.account.id, "acct_existing");
  assert.equal(result.account.nickname, "既有用户");
  assert.equal(result.account.version, 1);
  assert.equal(db.writes.length, 0);
});

test("昵称和用途确认由服务端校验", async () => {
  assert.equal(normalizeNickname("  桃桃  "), "桃桃");
  assert.equal(normalizeNickname("👨‍👩‍👧‍👦".repeat(12)), "👨‍👩‍👧‍👦".repeat(12));
  assert.throws(() => normalizeNickname(""), (error) => error.code === "INVALID_NICKNAME");
  assert.throws(() => normalizeNickname("超".repeat(13)), (error) => error.code === "INVALID_NICKNAME");
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
