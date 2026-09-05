const crypto = require("node:crypto");

const DEFAULT_ROLES = ["BUYER", "PROVIDER"];
const NOTICE_VERSION = "account-use-v1";

function identityKey(appId, openId) {
  return crypto.createHash("sha256").update(`${appId}:${openId}`).digest("hex");
}

function trustedIdentity(context) {
  const { OPENID: openId, APPID: appId, UNIONID: unionId } = context || {};
  if (!openId || !appId) {
    const error = new Error("trusted WeChat identity context is missing");
    error.code = "AUTH_CONTEXT_MISSING";
    throw error;
  }
  return { openId, appId, unionId };
}

function assertResult(result, operation) {
  if (result && result.error) {
    const error = new Error(`${operation} failed`);
    error.code = "DATABASE_OPERATION_FAILED";
    throw error;
  }
  return result || {};
}

function dbVersion(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    const error = new Error("account version is invalid");
    error.code = "DATABASE_OPERATION_FAILED";
    throw error;
  }
  return normalized;
}

function publicSession(account, roles) {
  if (!account) return { registered: false };
  if (account.status !== "ACTIVE") {
    const error = new Error("account is not active");
    error.code = account.status === "SUSPENDED" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_CLOSED";
    throw error;
  }
  return {
    registered: true,
    account: { ...account, version: dbVersion(account.version) },
    roles: (roles || []).map((item) => item.role).sort()
  };
}

async function readSession(db, context) {
  const { openId } = trustedIdentity(context);
  const identityResult = assertResult(
    await db.from("wechat_identities").select("account_id").eq("open_id", openId),
    "read identity"
  );
  const identity = identityResult.data && identityResult.data[0];
  if (!identity) return { registered: false };

  const [accountQuery, rolesQuery] = await Promise.all([
    db.from("accounts").select("id,uid,nickname,avatar_asset_id,status,version").eq("id", identity.account_id),
    db.from("account_roles").select("role").eq("account_id", identity.account_id)
  ]);
  const accountResult = assertResult(accountQuery, "read account");
  const rolesResult = assertResult(rolesQuery, "read roles");
  const account = accountResult.data && accountResult.data[0];
  if (!account) {
    const error = new Error("identity account was not found");
    error.code = "ACCOUNT_IDENTITY_INCOMPLETE";
    throw error;
  }
  return publicSession(account, rolesResult.data);
}

async function loginAccount(db, context) {
  const session = await readSession(db, context);
  if (!session.registered) {
    const error = new Error("account is not registered");
    error.code = "ACCOUNT_NOT_REGISTERED";
    throw error;
  }
  return session;
}

function normalizeNickname(value) {
  if (typeof value !== "string") {
    const error = new Error("nickname must be a string");
    error.code = "INVALID_NICKNAME";
    throw error;
  }
  const nickname = value.trim();
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("zh-CN", { granularity: "grapheme" }) : null;
  const length = segmenter ? Array.from(segmenter.segment(nickname)).length : Array.from(nickname).length;
  if (!length || length > 20 || /[\u0000-\u001f\u007f]/.test(nickname)) {
    const error = new Error("nickname must contain 1 to 20 characters");
    error.code = "INVALID_NICKNAME";
    throw error;
  }
  return nickname;
}

async function registerAccount(db, context, input = {}, now = Date.now()) {
  const identity = trustedIdentity(context);
  if (input.acceptedNotice !== true) {
    const error = new Error("account use notice must be accepted");
    error.code = "ACCOUNT_NOTICE_REQUIRED";
    throw error;
  }
  const nickname = normalizeNickname(input.nickname);
  const existing = await readSession(db, context);
  if (existing.registered) return { ...existing, created: false };

  const hash = identityKey(identity.appId, identity.openId);
  const accountId = `acct_${hash.slice(0, 32)}`;
  assertResult(await db.from("accounts").upsert({
    id: accountId,
    uid: `AM_${hash.slice(0, 12).toUpperCase()}`,
    nickname,
    status: "ACTIVE",
    version: 1,
    created_at: now,
    updated_at: now
  }, { ignoreDuplicates: true }), "upsert account");

  assertResult(await db.from("account_roles").upsert(DEFAULT_ROLES.map((role) => ({
    account_id: accountId,
    role,
    enabled_at: now
  })), { ignoreDuplicates: true }), "upsert account roles");

  assertResult(await db.from("account_registration_consents").upsert({
    account_id: accountId,
    notice_version: NOTICE_VERSION,
    accepted_at: now
  }, { ignoreDuplicates: true }), "upsert registration consent");

  const wechatIdentity = {
    account_id: accountId,
    open_id: identity.openId,
    created_at: now,
    updated_at: now
  };
  if (identity.unionId) wechatIdentity.union_id = identity.unionId;
  assertResult(
    await db.from("wechat_identities").upsert(wechatIdentity, { ignoreDuplicates: true }),
    "upsert identity"
  );

  const session = await loginAccount(db, context);
  return { ...session, created: true };
}

module.exports = {
  NOTICE_VERSION,
  identityKey,
  loginAccount,
  normalizeNickname,
  readSession,
  registerAccount,
  trustedIdentity
};
