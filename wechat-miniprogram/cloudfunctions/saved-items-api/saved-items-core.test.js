const test = require("node:test"); const assert = require("node:assert/strict"); const { handleSavedItems } = require("./saved-items-core");
function mockDb() {
  const saved = [
    { account_id: "acct_other", target_type: "PROVIDER", target_id: "acct_buyer", saved: 1, created_at: 1, updated_at: 1 },
    { account_id: "acct_other", target_type: "WORK", target_id: "work_mine", saved: 1, created_at: 1, updated_at: 1 },
    { account_id: "acct_other_2", target_type: "WORK", target_id: "work_mine", saved: 0, created_at: 1, updated_at: 2 }
  ]; const publications = [
    { provider_id: "acct_provider", payload: JSON.stringify({ works: [{ id: "work_1" }] }) },
    { provider_id: "acct_buyer", payload: JSON.stringify({ works: [{ id: "work_mine" }] }) }
  ];
  return { saved, from(table) { let operation = "select"; let value; const filters = []; const builder = {
    select() { return builder; }, eq(column, expected) { filters.push((row) => row[column] === expected); return builder; }, in(column, values) { filters.push((row) => values.includes(row[column])); return builder; }, upsert(input) { operation = "upsert"; value = input; return builder; },
    then(resolve) { const source = table === "account_saved_items" ? saved : table === "provider_catalog_publications" ? publications : table === "wechat_identities" ? [{ open_id: "openid", account_id: "acct_buyer" }] : [];
      let data = source.filter((row) => filters.every((filter) => filter(row)));
      if (table === "account_saved_items" && operation === "upsert") { const row = saved.find((item) => item.account_id === value.account_id && item.target_type === value.target_type && item.target_id === value.target_id); if (row) Object.assign(row, value); else saved.push(value); data = [value]; }
      return Promise.resolve({ data, error: null }).then(resolve); }
  }; return builder; } };
}
test("saves and removes public providers and works idempotently", async () => {
  const db = mockDb();
  await handleSavedItems(db, { action: "setSaved", targetType: "PROVIDER", targetId: "acct_provider", saved: true }, { WX_OPENID: "openid" }, 1000);
  await handleSavedItems(db, { action: "setSaved", targetType: "WORK", targetId: "work_1", saved: true }, { WX_OPENID: "openid" }, 2000);
  let list = await handleSavedItems(db, { action: "listMine" }, { WX_OPENID: "openid" });
  assert.deepEqual(list, { providerIds: ["acct_provider"], workIds: ["work_1"], receivedProviderFollows: 1, receivedWorkLikes: 1 });
  await handleSavedItems(db, { action: "setSaved", targetType: "WORK", targetId: "work_1", saved: false }, { WX_OPENID: "openid" }, 3000);
  list = await handleSavedItems(db, { action: "listMine" }, { WX_OPENID: "openid" }); assert.deepEqual(list.workIds, []);
});
test("counts only active follows and likes received by the current account", async () => {
  const result = await handleSavedItems(mockDb(), { action: "listMine" }, { WX_OPENID: "openid" });
  assert.equal(result.receivedProviderFollows, 1);
  assert.equal(result.receivedWorkLikes, 1);
});
test("rejects non-public targets and missing identity", async () => {
  await assert.rejects(() => handleSavedItems(mockDb(), { action: "setSaved", targetType: "WORK", targetId: "missing", saved: true }, { WX_OPENID: "openid" }), (error) => error.code === "TARGET_NOT_PUBLIC");
  await assert.rejects(() => handleSavedItems(mockDb(), { action: "listMine" }, {}), (error) => error.code === "AUTH_CONTEXT_MISSING");
});
