const test = require("node:test");
const assert = require("node:assert/strict");
const { handleAccount } = require("./account-core");
const ACCOUNT = "acct_buyer";
test("nickname rejection or missing reviewer leaves profile and version unchanged", async () => {
  for (const code of ["NICKNAME_REJECTED", "NICKNAME_REVIEW_REQUIRED", "NICKNAME_CHECK_UNAVAILABLE"]) {
    const db = mockDb();
    const before = JSON.stringify(db.accounts);
    await assert.rejects(handleAccount(db, { action: "updateMine", expectedVersion: 1, nickname: "新昵称", avatarAssetId: null }, { WX_OPENID: "openid" }, 2000, {
      reviewNickname: async (nickname, openid) => { assert.equal(nickname, "新昵称"); assert.equal(openid, "openid"); throw Object.assign(new Error(code), { code }); }
    }), { code });
    assert.equal(JSON.stringify(db.accounts), before);
  }
  await assert.rejects(handleAccount(mockDb(), { action: "updateMine", expectedVersion: 1, nickname: "新昵称" }, { WX_OPENID: "openid" }), { code: "NICKNAME_CHECK_UNAVAILABLE" });
  const unchanged = await handleAccount(mockDb(), { action: "updateMine", expectedVersion: 1, nickname: "微信用户" }, { WX_OPENID: "openid" });
  assert.equal(unchanged.nickname, "微信用户");
});
function mockDb() {
  const accounts = [{ id: ACCOUNT, uid: "AM-001", nickname: "微信用户", username: "Kehaar", avatar_asset_id: null, status: "ACTIVE", version: "1", updated_at: "1000" }];
  const assets = [{ id: "asset_00000000000000000000000000000001", owner_account_id: ACCOUNT, purpose: "AVATAR", status: "READY", storage_key: "cloud://avatar.jpg" }];
  const preferences = [], intents = [];
  return { accounts, assets, preferences, intents, from(table) {
    let operation = "select"; let value; const filters = [];
    const builder = { select() { return builder; }, eq(column, expected) { filters.push([column, expected]); return builder; }, update(input) { operation = "update"; value = input; return builder; }, insert(input) { operation = "insert"; value = input; return builder; }, then(resolve) {
      const source = table === "accounts" ? accounts : table === "media_assets" ? assets : table === "wechat_identities" ? [{ open_id: "openid", account_id: ACCOUNT }] : table === "account_discovery_preferences" ? preferences : table === "content_intents" ? intents : [];
      const matches = (row, column, expected) => column === "version" ? Number(row[column]) === Number(expected) : row[column] === expected;
      let data = source.filter((row) => filters.every(([column, expected]) => matches(row, column, expected)));
      if (table === "accounts" && operation === "update") { const row = data[0]; data = row ? (Object.assign(row, value), [{ id: row.id }]) : []; }
      if (table === "account_discovery_preferences" && operation === "insert") { preferences.push(value); data = [value]; }
      if (table === "account_discovery_preferences" && operation === "update") { const row = data[0]; data = row ? (Object.assign(row, value), [{ account_id: row.account_id }]) : []; }
      if (table === 'content_intents' && operation === 'insert') { intents.push(value); data = [value]; }
      if (table === 'content_intents' && operation === 'update') data.forEach(row => Object.assign(row, value));
      return Promise.resolve({ data, error: null }).then(resolve);
    } };
    return builder;
  } };
}
test("reads the trusted account and normalizes the CloudBase string version", async () => {
  const value = await handleAccount(mockDb(), { action: "getMine" }, { WX_OPENID: "openid" });
  assert.equal(value.version, 1); assert.equal(value.nickname, "微信用户"); assert.equal(value.avatarFileId, null);
  assert.equal(value.updatedAt, 1000); assert.equal(value.username, "Kehaar");
});

test('negative preference version checks the resolver but never saves test coordinates', async () => {
  const db = mockDb(); let resolved = false;
  await assert.rejects(() => handleAccount(db, { action: 'resolveDiscoveryLocation', latitude: 31.2, longitude: 121.5, expectedVersion: -1 }, { WX_OPENID: 'openid' }, 2000, {
    resolveRegion: async () => { resolved = true; return { provinceName: '上海市', cityName: '上海市', districtName: '黄浦区', cityCode: '310000' }; }
  }), error => error.code === 'VERSION_CONFLICT');
  assert.equal(resolved, true); assert.equal(db.preferences.length, 0);
});
test("updates nickname and an owned ready avatar with a version lock", async () => {
  const db = mockDb();
  const value = await handleAccount(db, { action: "updateMine", expectedVersion: 1, nickname: "云端昵称", avatarAssetId: "asset_00000000000000000000000000000001" }, { WX_OPENID: "openid" }, 2000, { reviewNickname: async () => {} });
  assert.equal(value.version, 2); assert.equal(value.nickname, "云端昵称"); assert.equal(value.avatarFileId, "cloud://avatar.jpg");
  await assert.rejects(() => handleAccount(db, { action: "updateMine", expectedVersion: 1, nickname: "旧昵称", avatarAssetId: null }, { WX_OPENID: "openid" }), (error) => error.code === "VERSION_CONFLICT");
});
test("avatar invalidated during save is not returned as a usable file", async () => {
  const db = mockDb(); const from = db.from; let mediaReads = 0;
  db.from = table => {
    if (table === 'media_assets' && ++mediaReads === 2) db.assets[0].status = 'REJECTED';
    return from(table);
  };
  const result = await handleAccount(db, { action: 'updateMine', expectedVersion: 1,
    nickname: '微信用户', avatarAssetId: 'asset_00000000000000000000000000000001' }, { WX_OPENID: 'openid' });
  assert.equal(result.avatarFileId, null);
});
test("rejects invalid nickname, foreign avatar and missing trusted identity", async () => {
  await assert.rejects(() => handleAccount(mockDb(), { action: "updateMine", expectedVersion: 1, nickname: "", avatarAssetId: null }, { WX_OPENID: "openid" }), (error) => error.code === "VALIDATION_ERROR");
  await assert.rejects(() => handleAccount(mockDb(), { action: "updateMine", expectedVersion: 1, nickname: "昵称", avatarAssetId: "asset_ffffffffffffffffffffffffffffffff" }, { WX_OPENID: "openid" }), (error) => error.code === "AVATAR_NOT_READY");
  await assert.rejects(() => handleAccount(mockDb(), { action: "getMine" }, {}), (error) => error.code === "AUTH_CONTEXT_MISSING");
});

test("profile nickname validation matches registration for graphemes and controls", async () => {
  const family = "👨‍👩‍👧‍👦";
  const db = mockDb();
  const updated = await handleAccount(db, { action: "updateMine", expectedVersion: 1, nickname: family.repeat(12), avatarAssetId: null }, { WX_OPENID: "openid" }, 2000, { reviewNickname: async () => {} });
  assert.equal(updated.nickname, family.repeat(12));
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

test('location resolution reads the preference while the map request is pending, and preserves concurrent manual changes', async () => {
  const db = mockDb();
  const region = { provinceName: '上海市', cityName: '上海市', districtName: '', cityCode: '310000' };
  await handleAccount(db, { action: 'saveDiscoveryPreference', expectedVersion: 0, source: 'MANUAL', region }, { WX_OPENID: 'openid' }, 1000);
  let finishMap, reads = 0;
  const originalFrom = db.from;
  db.from = function(table) { if (table === 'account_discovery_preferences') reads++; return originalFrom.call(this, table); };
  const pending = handleAccount(db, { action: 'resolveDiscoveryLocation', expectedVersion: 1, latitude: 31, longitude: 121 }, { WX_OPENID: 'openid' }, 2000, {
    resolveRegion: () => new Promise(resolve => { finishMap = resolve; })
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1, 'preference read must not wait for the map response');
  await handleAccount(db, { action: 'saveDiscoveryPreference', expectedVersion: 1, source: 'MANUAL', region }, { WX_OPENID: 'openid' }, 3000);
  finishMap(region);
  await assert.rejects(pending, { code: 'VERSION_CONFLICT' });
  assert.equal(db.preferences[0].source, 'MANUAL');
  assert.equal(db.preferences[0].version, 2);
});

test('pending avatar requires explicit deferred consent; nickname saves and old avatar stays public', async () => {
 process.env.CONTENT_INTENTS_ENABLED = 'true';
 try {
  const db=mockDb(); db.assets[0].status='PENDING';
  const event={action:'updateMine',expectedVersion:1,nickname:'微信用户',avatarAssetId:db.assets[0].id};
  await assert.rejects(handleAccount(db,event,{WX_OPENID:'openid'}),{code:'AVATAR_NOT_READY'});
  assert.equal(db.intents.length,0);
  const result=await handleAccount(db,{...event,allowDeferred:true},{WX_OPENID:'openid'},2000);
  assert.equal(result.avatarAssetId,null); assert.equal(result.version,2);
  assert.equal(result.contentIntent.status,'PENDING'); assert.equal(db.intents[0].expected_version,2);
  const next=await handleAccount(db,{...event,expectedVersion:2,avatarAssetId:null},{WX_OPENID:'openid'},3000);
  assert.equal(next.contentIntent,null); assert.equal(db.accounts[0].pending_content_intent_id,null);
 } finally {delete process.env.CONTENT_INTENTS_ENABLED;}
});
