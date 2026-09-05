const test = require("node:test");
const assert = require("node:assert/strict");
const { handleAccount } = require("./account-core");
const ACCOUNT = "acct_buyer";
function mockDb() {
  const accounts = [{ id: ACCOUNT, uid: "AM-001", nickname: "微信用户", avatar_asset_id: null, status: "ACTIVE", version: "1", updated_at: "1000" }];
  const assets = [{ id: "asset_00000000000000000000000000000001", owner_account_id: ACCOUNT, purpose: "AVATAR", status: "READY", storage_key: "cloud://avatar.jpg" }];
  const preferences = [];
  return { accounts, preferences, from(table) {
    let operation = "select"; let value; const filters = [];
    const builder = { select() { return builder; }, eq(column, expected) { filters.push([column, expected]); return builder; }, update(input) { operation = "update"; value = input; return builder; }, insert(input) { operation = "insert"; value = input; return builder; }, then(resolve) {
      const source = table === "accounts" ? accounts : table === "media_assets" ? assets : table === "wechat_identities" ? [{ open_id: "openid", account_id: ACCOUNT }] : table === "account_discovery_preferences" ? preferences : [];
      const matches = (row, column, expected) => column === "version" ? Number(row[column]) === Number(expected) : row[column] === expected;
      let data = source.filter((row) => filters.every(([column, expected]) => matches(row, column, expected)));
      if (table === "accounts" && operation === "update") { const row = data[0]; data = row ? (Object.assign(row, value), [{ id: row.id }]) : []; }
      if (table === "account_discovery_preferences" && operation === "insert") { preferences.push(value); data = [value]; }
      if (table === "account_discovery_preferences" && operation === "update") { const row = data[0]; data = row ? (Object.assign(row, value), [{ account_id: row.account_id }]) : []; }
      return Promise.resolve({ data, error: null }).then(resolve);
    } };
    return builder;
  } };
}
test("reads the trusted account and normalizes the CloudBase string version", async () => {
  const value = await handleAccount(mockDb(), { action: "getMine" }, { WX_OPENID: "openid" });
  assert.equal(value.version, 1); assert.equal(value.nickname, "微信用户"); assert.equal(value.avatarFileId, null);
  assert.equal(value.updatedAt, 1000);
});
test("updates nickname and an owned ready avatar with a version lock", async () => {
  const db = mockDb();
  const value = await handleAccount(db, { action: "updateMine", expectedVersion: 1, nickname: "云端昵称", avatarAssetId: "asset_00000000000000000000000000000001" }, { WX_OPENID: "openid" }, 2000);
  assert.equal(value.version, 2); assert.equal(value.nickname, "云端昵称"); assert.equal(value.avatarFileId, "cloud://avatar.jpg");
  await assert.rejects(() => handleAccount(db, { action: "updateMine", expectedVersion: 1, nickname: "旧昵称", avatarAssetId: null }, { WX_OPENID: "openid" }), (error) => error.code === "VERSION_CONFLICT");
});
test("rejects invalid nickname, foreign avatar and missing trusted identity", async () => {
  await assert.rejects(() => handleAccount(mockDb(), { action: "updateMine", expectedVersion: 1, nickname: "", avatarAssetId: null }, { WX_OPENID: "openid" }), (error) => error.code === "VALIDATION_ERROR");
  await assert.rejects(() => handleAccount(mockDb(), { action: "updateMine", expectedVersion: 1, nickname: "昵称", avatarAssetId: "asset_ffffffffffffffffffffffffffffffff" }, { WX_OPENID: "openid" }), (error) => error.code === "AVATAR_NOT_READY");
  await assert.rejects(() => handleAccount(mockDb(), { action: "getMine" }, {}), (error) => error.code === "AUTH_CONTEXT_MISSING");
});

test("profile nickname validation matches registration for graphemes and controls", async () => {
  const family = "👨‍👩‍👧‍👦";
  const db = mockDb();
  const updated = await handleAccount(db, { action: "updateMine", expectedVersion: 1, nickname: family.repeat(20), avatarAssetId: null }, { WX_OPENID: "openid" }, 2000);
  assert.equal(updated.nickname, family.repeat(20));
  await assert.rejects(() => handleAccount(mockDb(), { action: "updateMine", expectedVersion: 1, nickname: "正常\u0000伪装", avatarAssetId: null }, { WX_OPENID: "openid" }), (error) => error.code === "VALIDATION_ERROR");
});

test("creates, reads and manually replaces a discovery city with a version lock", async () => {
  const db = mockDb();
  const empty = await handleAccount(db, { action: "getDiscoveryPreference" }, { WX_OPENID: "openid" });
  assert.equal(empty.preference, null);
  const created = await handleAccount(db, { action: "saveDiscoveryPreference", expectedVersion: 0, source: "MANUAL", region: { provinceName: "上海市", cityName: "上海市", districtName: "徐汇区", cityCode: "310000" } }, { WX_OPENID: "openid" }, 3000);
  assert.equal(created.preference.cityCode, "310000"); assert.equal(created.preference.source, "MANUAL"); assert.equal(created.preference.version, 1);
  const read = await handleAccount(db, { action: "getDiscoveryPreference" }, { WX_OPENID: "openid" });
  assert.equal(read.preference.cityName, "上海市");
  const updated = await handleAccount(db, { action: "saveDiscoveryPreference", expectedVersion: 1, source: "PROJECT", region: { provinceName: "浙江省", cityName: "杭州市", cityCode: "330100" } }, { WX_OPENID: "openid" }, 4000);
  assert.equal(updated.preference.cityCode, "330100"); assert.equal(updated.preference.version, 2);
  await assert.rejects(() => handleAccount(db, { action: "saveDiscoveryPreference", expectedVersion: 1, source: "MANUAL", region: { cityName: "北京市", cityCode: "110000" } }, { WX_OPENID: "openid" }, 5000), (error) => error.code === "VERSION_CONFLICT");
  await assert.rejects(() => handleAccount(db, { action: "saveDiscoveryPreference", expectedVersion: 2, source: "MANUAL", region: { cityName: "徐汇区", cityCode: "310104" } }, { WX_OPENID: "openid" }, 5000), (error) => error.code === "VALIDATION_ERROR");
});

test("resolves fuzzy coordinates on the server and never accepts a client supplied city as located", async () => {
  const db = mockDb();
  const result = await handleAccount(db, { action: "resolveDiscoveryLocation", expectedVersion: 0, latitude: 31.23, longitude: 121.47 }, { WX_OPENID: "openid" }, 6000, {
    resolveRegion: async () => ({ provinceName: "上海市", cityName: "上海市", districtName: "黄浦区", cityCode: "310000" })
  });
  assert.equal(result.preference.source, "LOCATED"); assert.equal(result.preference.locatedAt, 6000);
  await assert.rejects(() => handleAccount(mockDb(), { action: "resolveDiscoveryLocation", expectedVersion: 0, latitude: 999, longitude: 121.47 }, { WX_OPENID: "openid" }, 6000, { resolveRegion: async () => ({}) }), (error) => error.code === "VALIDATION_ERROR");
});
