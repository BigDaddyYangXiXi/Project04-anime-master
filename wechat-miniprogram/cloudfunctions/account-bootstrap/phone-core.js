const crypto = require("node:crypto");
const { identityKey, loginAccount, registerAccount, trustedIdentity } = require("./identity-core");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function phoneFingerprint(phoneNumber, key) {
  if (!key || String(key).length < 32) fail("PHONE_IDENTITY_NOT_CONFIGURED", "phone identity key is missing");
  const normalized = String(phoneNumber || "").replace(/\D/g, "");
  if (normalized.length < 7 || normalized.length > 20) fail("PHONE_VERIFICATION_FAILED", "verified phone is invalid");
  return crypto.createHmac("sha256", key).update(normalized).digest("hex");
}

function maskPhone(phoneNumber) {
  const value = String(phoneNumber || "").replace(/\D/g, "");
  if (value.length <= 7) return `${value.slice(0, 2)}***${value.slice(-2)}`;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function assertResult(result, operation) {
  if (result && result.error) fail("DATABASE_OPERATION_FAILED", `${operation} failed`);
  return result || {};
}

async function readPhoneIdentity(db, fingerprint) {
  const result = assertResult(
    await db.from("account_phone_identities").select("account_id,phone_masked").eq("phone_fingerprint", fingerprint),
    "read phone identity"
  );
  return result.data && result.data[0] || null;
}

async function readWechatIdentity(db, openId) {
  const result = assertResult(
    await db.from("wechat_identities").select("account_id").eq("open_id", openId),
    "read current identity"
  );
  return result.data && result.data[0] || null;
}

async function bindWechatIdentity(db, context, accountId, now) {
  const identity = trustedIdentity(context);
  const currentRow = await readWechatIdentity(db, identity.openId);
  if (currentRow && currentRow.account_id !== accountId) fail("ACCOUNT_LINK_CONFLICT", "wechat identity belongs to another account");
  if (currentRow) return;
  const value = { account_id: accountId, open_id: identity.openId, created_at: now, updated_at: now };
  if (identity.unionId) value.union_id = identity.unionId;
  assertResult(await db.from("wechat_identities").upsert(value, { ignoreDuplicates: true }), "bind wechat identity");
  const confirmed = await readWechatIdentity(db, identity.openId);
  if (!confirmed || confirmed.account_id !== accountId) fail("ACCOUNT_LINK_CONFLICT", "wechat identity binding was not committed");
}

async function loginByPhone(db, context, phoneInfo, key, now = Date.now()) {
  const fingerprint = phoneFingerprint(phoneInfo.phoneNumber, key);
  const phoneIdentity = await readPhoneIdentity(db, fingerprint);
  if (!phoneIdentity) fail("ACCOUNT_NOT_REGISTERED", "phone is not registered");
  await bindWechatIdentity(db, context, phoneIdentity.account_id, now);
  return { ...(await loginAccount(db, context)), phoneMasked: phoneIdentity.phone_masked };
}

async function registerByPhone(db, context, input, phoneInfo, key, now = Date.now()) {
  const fingerprint = phoneFingerprint(phoneInfo.phoneNumber, key);
  if (!/^[0-9]{1,4}$/.test(String(phoneInfo.countryCode || ''))) fail('PHONE_VERIFICATION_FAILED', 'verified country code missing');
  const identity = trustedIdentity(context);
  const linked = await readWechatIdentity(db, identity.openId);
  const phoneOwner = await readPhoneIdentity(db, fingerprint);
  const ownId = linked?.account_id || `acct_${identityKey(identity.appId, identity.openId).slice(0, 32)}`;
  if (phoneOwner && phoneOwner.account_id !== ownId) fail("PHONE_ALREADY_REGISTERED", "phone already belongs to an account");
  const session = await registerAccount(db, context, input, now, {
    phone_fingerprint: fingerprint, phone_masked: maskPhone(phoneInfo.phoneNumber), country_code: String(phoneInfo.countryCode || '')
  });
  return { ...session, phoneMasked: maskPhone(phoneInfo.phoneNumber) };
}

module.exports = { loginByPhone, maskPhone, phoneFingerprint, registerByPhone };
