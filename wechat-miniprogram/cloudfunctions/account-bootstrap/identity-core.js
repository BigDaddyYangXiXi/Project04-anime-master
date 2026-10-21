const crypto = require("node:crypto");
const { nicknameKey, normalizeUsername, checkNames } = require('./account-names');

const DEFAULT_ROLES = ["BUYER", "PROVIDER"];
const NOTICE_VERSION = "account-use-v5";

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
  if (account.status === "PENDING") return { registered: false };
  if (account.status !== "ACTIVE") {
    const error = new Error("account is not active");
    error.code = account.status === "SUSPENDED" ? "ACCOUNT_SUSPENDED" : "ACCOUNT_CLOSED";
    throw error;
  }
  return {
    registered: true,
    account: { id: account.id, uid: account.uid, nickname: account.nickname,
      avatar_asset_id: account.avatar_asset_id || null, status: account.status, version: dbVersion(account.version) },
    roles: (roles || []).map((item) => item.role).sort()
  };
}

async function readStorefrontState(db, providerId) {
  try {
    const [draft, publication, legacy] = await Promise.all([
      db.from("provider_catalog_drafts").select("version").eq("provider_id", providerId),
      db.from("provider_catalog_publications").select("publication_version").eq("provider_id", providerId),
      db.from("provider_profiles").select("provider_id").eq("provider_id", providerId).eq("publish_status", "PUBLISHED")
    ]);
    for (const result of [draft, publication, legacy]) {
      if (!result || result.error || !Array.isArray(result.data)) return null;
    }
    return {
      draftVersion: draft.data.length ? dbVersion(draft.data[0].version) : 0,
      hasPublication: Boolean(publication.data.length || legacy.data.length)
    };
  } catch (_) {
    // Missing metadata must never become a false empty state or block login.
    return null;
  }
}

async function readSession(db, context) {
  const { openId } = trustedIdentity(context);
  const identityResult = assertResult(
    await db.from("wechat_identities").select("account_id").eq("open_id", openId),
    "read identity"
  );
  const identity = identityResult.data && identityResult.data[0];
  if (!identity) return { registered: false };

  const [accountQuery, rolesQuery, preferenceQuery, storefrontState] = await Promise.all([
    db.from("accounts").select("id,uid,nickname,avatar_asset_id,status,version").eq("id", identity.account_id),
    db.from("account_roles").select("role").eq("account_id", identity.account_id),
    db.from("account_discovery_preferences").select("province_name,city_name,district_name,city_code,source,located_at,version,updated_at").eq("account_id", identity.account_id),
    readStorefrontState(db, identity.account_id)
  ]);
  const accountResult = assertResult(accountQuery, "read account");
  const rolesResult = assertResult(rolesQuery, "read roles");
  const account = accountResult.data && accountResult.data[0];
  if (!account) {
    const error = new Error("identity account was not found");
    error.code = "ACCOUNT_IDENTITY_INCOMPLETE";
    throw error;
  }
  const session = publicSession(account, rolesResult.data);
  if (session.registered) session.storefrontState = storefrontState;
  if (preferenceQuery?.error) return session;
  const row = preferenceQuery?.data?.[0];
  const discoveryPreference = row ? { provinceName: row.province_name || "", cityName: row.city_name,
    districtName: row.district_name || "", cityCode: row.city_code, source: row.source,
    locatedAt: row.located_at == null ? null : Number(row.located_at), version: dbVersion(row.version), updatedAt: Number(row.updated_at) } : null;
  return { ...session, discoveryPreference };
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
  if (!length || length > 12 || /[\u0000-\u001f\u007f\u200b\u202a-\u202e\u2066-\u2069\ufeff]/.test(nickname) || nickname.length > 144) {
    const error = new Error("nickname must contain 1 to 12 characters");
    error.code = "INVALID_NICKNAME";
    throw error;
  }
  return nickname;
}

async function registerAccount(db, context, input = {}, now = Date.now(), verifiedPhone) {
  const identity = trustedIdentity(context);
  if (input.acceptedNotice !== true) {
    const error = new Error("account use notice must be accepted");
    error.code = "ACCOUNT_NOTICE_REQUIRED";
    throw error;
  }
  if (input.noticeVersion !== NOTICE_VERSION) {
    const error = new Error("agreement version changed"); error.code = "ACCOUNT_NOTICE_OUTDATED"; throw error;
  }
  const nickname = normalizeNickname(input.nickname);
  const username = normalizeUsername(input.username);
  if (!verifiedPhone || !/^[a-f0-9]{64}$/.test(verifiedPhone.phone_fingerprint)) {
    const error = new Error('verified phone required'); error.code = 'PHONE_AUTH_REQUIRED'; throw error;
  }
  const existing = await readSession(db, context);
  if (existing.registered) {
    const phone = assertResult(await db.from('account_phone_identities').select('phone_fingerprint').eq('account_id', existing.account.id), 'read registered phone').data?.[0];
    if (phone?.phone_fingerprint !== verifiedPhone.phone_fingerprint) {
      const error = new Error('account phone differs'); error.code = 'ACCOUNT_PHONE_ALREADY_BOUND'; throw error;
    }
    return { ...existing, created: false };
  }

  const hash = identityKey(identity.appId, identity.openId);
  const linked = assertResult(await db.from('wechat_identities').select('account_id').eq('open_id', identity.openId), 'read identity').data?.[0];
  const accountId = linked?.account_id || `acct_${hash.slice(0, 32)}`;
  const readPending = async () => assertResult(await db.from('accounts').select('*').eq('id', accountId), 'read pending account').data?.[0];
  await checkNames(db, nickname, username, accountId);
  const phoneOwner = assertResult(await db.from('accounts').select('id').eq('registration_phone_fingerprint', verifiedPhone.phone_fingerprint), 'read phone owner').data?.[0];
  if (phoneOwner && phoneOwner.id !== accountId) {
    const error = new Error('phone taken'); error.code = 'PHONE_ALREADY_REGISTERED'; throw error;
  }
  let pending = await readPending();
  const values = { nickname, nickname_key: nicknameKey(nickname), username,
    registration_phone_fingerprint: verifiedPhone.phone_fingerprint, registration_version: 3,
    status: 'PENDING', updated_at: now };
  if (!pending || pending.status === 'PENDING' && Number(pending.registration_version) === 0) {
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      const uid = String(crypto.randomInt(100000000000, 1000000000000));
      result = pending
        ? await db.from('accounts').update({ ...values, uid, version: dbVersion(pending.version) + 1 }).eq('id', accountId).eq('status', 'PENDING').eq('version', pending.version).select('id')
        : await db.from('accounts').insert({ ...values, uid, id: accountId, version: 1, created_at: now });
      if (!result?.error) break;
      await checkNames(db, nickname, username, accountId);
      const claimed = assertResult(await db.from('accounts').select('id').eq('registration_phone_fingerprint', verifiedPhone.phone_fingerprint), 'read claimed phone').data?.[0];
      if (claimed && claimed.id !== accountId) { const error = new Error('phone taken'); error.code = 'PHONE_ALREADY_REGISTERED'; throw error; }
      const raced = await readPending();
      if (raced) break;
      const collision = assertResult(await db.from('accounts').select('id').eq('uid', uid), 'check uid').data?.[0];
      if (!collision) assertResult(result, 'create pending account');
    }
    pending = await readPending();
  }
  if (!pending || !['PENDING', 'ACTIVE'].includes(pending.status) || pending.nickname_key !== values.nickname_key
      || pending.username !== username || pending.registration_phone_fingerprint !== verifiedPhone.phone_fingerprint
      || Number(pending.registration_version) !== 3) {
    const error = new Error('registration changed'); error.code = 'REGISTRATION_CONFLICT'; throw error;
  }

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

  assertResult(await db.from('account_phone_identities').upsert({ account_id: accountId, ...verifiedPhone,
    verification_method: 'REALTIME', verified_at: now, created_at: now, updated_at: now
  }, { ignoreDuplicates: true }), 'bind verified phone');
  const boundPhone = assertResult(await db.from('account_phone_identities').select('phone_fingerprint').eq('account_id', accountId), 'confirm phone').data?.[0];
  if (boundPhone?.phone_fingerprint !== verifiedPhone.phone_fingerprint) {
    const error = new Error('phone binding conflict'); error.code = 'ACCOUNT_PHONE_ALREADY_BOUND'; throw error;
  }

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

  const confirmedIdentity = assertResult(await db.from('wechat_identities').select('account_id').eq('open_id', identity.openId), 'confirm identity').data?.[0];
  if (confirmedIdentity?.account_id !== accountId) { const error = new Error('identity conflict'); error.code = 'ACCOUNT_LINK_CONFLICT'; throw error; }
  assertResult(await db.from('accounts').update({ status: 'ACTIVE', updated_at: now }).eq('id', accountId).eq('status', 'PENDING').eq('registration_version', 3), 'activate registration');

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
