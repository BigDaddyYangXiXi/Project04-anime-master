const test = require("node:test");
const assert = require("node:assert/strict");
const { handleProviderDraft: realhandleProviderDraft, normalizeDraft } = require("./draft-core");
const handleProviderDraft = (db,event,context,now,dependencies={ reviewServiceNames: async()=>{} }) => realhandleProviderDraft(db,event,context,now,dependencies);

function mockDb({ draft = null, publication = null, providerRole = true } = {}) {
  const writes = [];
  return {
    writes,
    from(table) {
      let filters = [];
      let operation = "select";
      let value;
      const builder = {
        select() { return builder; },
        eq(column, expected) { filters.push([column, expected]); return builder; },
        insert(input) { operation = "insert"; value = input; return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          if (operation !== "select") writes.push({ table, operation, value, filters });
          let data = [];
          if (operation === "insert") data = [value];
          else if (operation === "update") data = filters.some(([key, expected]) => key === "version" && draft && Number(expected) !== Number(draft.version)) ? [] : [{ version: value.version }];
          else if (table === "wechat_identities") data = [{ account_id: "provider_me" }];
          else if (table === "accounts") data = [{ id: "provider_me", status: "ACTIVE" }].filter(row => filters.every(([key, expected]) => row[key] === expected));
          else if (table === "account_roles") data = providerRole ? [{ role: "PROVIDER" }] : [];
          else if (table === "provider_catalog_drafts") data = draft ? [draft] : [];
          else if (table === "provider_catalog_publications") data = publication && filters.some(([key, expected]) => key === 'provider_id' && expected === 'provider_me') ? [publication] : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

const validDraft = {
  profile: { career: "妆娘", city: "杭州", bio: "简介", notice: "须知", tags: ["骨相调整"] },
  services: [{ id: "service_1", name: "角色妆造", priceFen: 52000, unit: "人次", description: "说明", workIds: ["work_1"] }],
  works: [{ id: "work_1", title: "夜航者", subtitle: "男性角色妆", priceFen: 52000, description: "作品说明", tone: "coral", tags: ["男角"], imageAssetIds: [] }],
  pinnedWorkIds: ["work_1"]
};

test("首次保存只使用可信身份中的服务者账号", async () => {
  const db = mockDb();
  const result = await handleProviderDraft(db, { action: "saveDraft", expectedVersion: 0, accountId: "attacker", draft: validDraft }, { WX_OPENID: "openid-me" }, 1234);
  assert.equal(result.version, 1);
  assert.equal(db.writes[0].value.provider_id, "provider_me");
  assert.equal(JSON.stringify(db.writes).includes("attacker"), false);
});

test("读取不存在的草稿返回版本零和空结构", async () => {
  const result = await handleProviderDraft(mockDb(), { action: "getDraft" }, { WX_OPENID: "openid-me" });
  assert.equal(result.version, 0);
  assert.deepEqual(result.draft.services, []);
});

test('发布检查只读取可信账号的公开快照，不信任传入服务方编号且零写入', async () => {
  const db=mockDb({draft:{version:3,updated_at:1234,payload:validDraft},publication:{payload:validDraft,draft_version:2,publication_version:1}});
  const result=await handleProviderDraft(db,{action:'getWorkspaceReview',providerId:'attacker'},{WX_OPENID:'openid-me'});
  assert.equal(result.providerId,'provider_me');
  assert.equal(result.draftVersion,3);
  assert.equal(result.publishedDraftVersion,2);
  assert.deepEqual(result.publication,validDraft);
  assert.equal(db.writes.length,0);
  await assert.rejects(handleProviderDraft(db,{action:'getWorkspaceReview'},{}));
});

test("版本不一致时拒绝覆盖", async () => {
  const db = mockDb({ draft: { payload: validDraft, version: 3, updated_at: 100 } });
  await assert.rejects(
    () => handleProviderDraft(db, { action: "saveDraft", expectedVersion: 2, draft: validDraft }, { WX_OPENID: "openid-me" }),
    (error) => error.code === "VERSION_CONFLICT"
  );
  assert.equal(db.writes.length, 0);
});

test("数据库返回字符串版本时仍可读取并按数字版本保存", async () => {
  const db = mockDb({ draft: { payload: validDraft, version: "3", updated_at: "100" } });
  const read = await handleProviderDraft(db, { action: "getDraft" }, { WX_OPENID: "openid-me" });
  assert.equal(read.version, 3);
  assert.equal(read.updatedAt, 100);
  const saved = await handleProviderDraft(db, { action: "saveDraft", expectedVersion: 3, draft: validDraft }, { WX_OPENID: "openid-me" }, 200);
  assert.equal(saved.version, 4);
});

test("缺少可信身份或服务方角色时拒绝", async () => {
  await assert.rejects(() => handleProviderDraft(mockDb(), { action: "getDraft" }, {}), (error) => error.code === "AUTH_CONTEXT_MISSING");
  await assert.rejects(() => handleProviderDraft(mockDb({ providerRole: false }), { action: "getDraft" }, { WX_OPENID: "openid-me" }), (error) => error.code === "PROVIDER_ROLE_REQUIRED");
});

test("草稿结构拒绝重复 ID、跨引用和超过五张图片", () => {
  assert.throws(() => normalizeDraft({ ...validDraft, pinnedWorkIds: ["unknown"] }), (error) => error.code === "VALIDATION_ERROR");
  assert.throws(() => normalizeDraft({ ...validDraft, works: [{ ...validDraft.works[0], imageAssetIds: ["a", "b", "c", "d", "e", "f"] }] }), (error) => error.code === "VALIDATION_ERROR");
  assert.throws(() => normalizeDraft({
    ...validDraft,
    services: [validDraft.services[0], { ...validDraft.services[0], id: "service_2" }]
  }), (error) => error.code === "VALIDATION_ERROR");
});


test('service name review failure blocks saveDraft before any write', async () => {
 for(const code of ['SERVICE_NAME_REJECTED','SERVICE_NAME_CHECK_UNAVAILABLE']){
  const db=mockDb();let checked=false;
  await assert.rejects(handleProviderDraft(db,{action:'saveDraft',expectedVersion:0,draft:validDraft},{WX_OPENID:'trusted'},1234,{reviewServiceNames:async(services,openid)=>{checked=true;assert.equal(openid,'trusted');assert.equal(services[0].name,validDraft.services[0].name);throw Object.assign(Error(code),{code});}}),{code});
  assert.equal(checked,true);assert.equal(db.writes.length,0);
 }
});
