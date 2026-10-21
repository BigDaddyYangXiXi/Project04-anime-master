const test = require("node:test");
const assert = require("node:assert/strict");
const { handleProviderPublish: realhandleProviderPublish } = require("./publication-core");
const handleProviderPublish = (db,event,context,now,dependencies={ reviewServiceNames: async()=>{} }) => realhandleProviderPublish(db,event,context,now,dependencies);
const { handleQualification } = require("./qualification-core");

const PROVIDER_ID = "provider_me";
const ASSETS = [
  "asset_11111111111111111111111111111111",
  "asset_22222222222222222222222222222222",
  "asset_33333333333333333333333333333333"
];

const validDraft = {
  profile: { career: "妆娘", city: "杭州", cityCode: "330100", bio: "简介", notice: "须知", noticeImageAssetId: null, tags: ["骨相调整"] },
  services: [{ id: "service_1", name: "角色妆造", priceFen: 52000, unit: "人次", description: "说明", workIds: ["work_1", "work_2", "work_3"], serviceMode: "ONSITE", serviceAreas: [] }],
  works: ASSETS.map((assetId, index) => ({
    id: `work_${index + 1}`,
    title: `作品${index + 1}`,
    subtitle: "副标题",
    priceFen: 52000,
    description: "作品说明",
    tone: "coral",
    tags: ["男角"],
    imageAssetIds: [assetId]
  })),
  pinnedWorkIds: ["work_1"]
};

function mockDb({ draft = validDraft, draftVersion = 3, readyAssets = ASSETS, publication = null, conflict = false } = {}) {
  const fixtures = {
    wechat_identities: [{ open_id: "openid-me", account_id: PROVIDER_ID }],
    account_roles: [{ account_id: PROVIDER_ID, role: "PROVIDER" }],
    accounts: [{ id: PROVIDER_ID, nickname: "南烛", status: "ACTIVE" }],
    provider_qualifications: [{ provider_id: PROVIDER_ID, career: "妆娘", status: "APPROVED", eligibility_verified: 1 }],
    provider_catalog_drafts: draft ? [{ provider_id: PROVIDER_ID, payload: draft, version: draftVersion, updated_at: 100 }] : [],
    media_assets: readyAssets.map((id) => ({ id, owner_account_id: PROVIDER_ID, purpose: "WORK_IMAGE", status: "READY" })),
    provider_catalog_publications: publication ? [{ provider_id: PROVIDER_ID, ...publication }] : []
  };
  const writes = [];
  return {
    fixtures,
    writes,
    from(table) {
      let operation = "select";
      let value = null;
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(column, expected) {
          filters.push((row) => ["version", "draft_version", "publication_version"].includes(column)
            ? Number(row[column]) === Number(expected)
            : row[column] === expected);
          return builder;
        },
        in(column, values) { filters.push((row) => values.includes(row[column])); return builder; },
        insert(input) { operation = "insert"; value = input; return builder; },
        update(input) { operation = "update"; value = input; return builder; },
        then(resolve) {
          const source = fixtures[table] || (fixtures[table] = []);
          const matched = source.filter((row) => filters.every((filter) => filter(row)));
          if (operation === "insert") {
            writes.push({ table, operation, value });
            if (conflict) return Promise.resolve({ data: [], error: { code: "DUPLICATE" } }).then(resolve);
            source.push({ ...value });
            return Promise.resolve({ data: [{ ...value }], error: null }).then(resolve);
          }
          if (operation === "update") {
            writes.push({ table, operation, value });
            const updated = conflict ? [] : matched;
            updated.forEach((row) => Object.assign(row, value));
            return Promise.resolve({ data: updated.map((row) => ({ ...row })), error: null }).then(resolve);
          }
          return Promise.resolve({ data: matched.map((row) => ({ ...row })), error: null }).then(resolve);
        }
      };
      return builder;
    }
  };
}

test("publishes one complete owned snapshot from the exact draft version", async () => {
  const db = mockDb();
  const result = await handleProviderPublish(
    db,
    { action: "publishDraft", expectedVersion: 3, providerId: "attacker" },
    { WX_OPENID: "openid-me" },
    2000
  );

  assert.deepEqual(result, { providerId: PROVIDER_ID, draftVersion: 3, publicationVersion: 1, publishedAt: 2000, worksCount: 3 });
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].table, "provider_catalog_publications");
  const payload = JSON.parse(db.writes[0].value.payload);
  assert.equal(payload.works.length, 3);
  assert.match(payload.works[0].code, /^AM-[A-F0-9]{10}$/);
  assert.equal(JSON.stringify(db.writes).includes("attacker"), false);
});

test("publication no longer needs onboarding approval, including historical pending and rejected applications", async () => {
  for (const qualification of [null, { status: "PENDING" }, { status: "REJECTED" },
    { status: "APPROVED", eligibility_verified: 0 }, { status: "APPROVED", eligibility_verified: 1, career: "摄影" }]) {
    const db = mockDb();
    db.fixtures.provider_qualifications = qualification ? [{ provider_id: PROVIDER_ID, career: "妆娘", ...qualification }] : [];
    await handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" });
    assert.equal(db.writes.length, 1);
  }
});

test("explicit suspension still blocks publishing", async () => {
  const db = mockDb();
  db.fixtures.provider_qualifications[0].status = "SUSPENDED";
  await assert.rejects(handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }), { code: "PROVIDER_NOT_AVAILABLE" });
  assert.equal(db.writes.length, 0);
});

test("retired qualification actions authenticate but never submit or approve an application", async () => {
  const db = mockDb();
  db.fixtures.provider_qualifications = [];
  const event = { action: "submitQualification", providerId: "attacker", status: "APPROVED", eligibility_verified: 1, reviewed_by: "fake" };
  const submitted = await handleQualification(db, event, { WX_OPENID: "openid-me" }, 2000);
  assert.equal(submitted.status, "NOT_REQUIRED");
  assert.deepEqual(db.fixtures.provider_qualifications, []);
  await handleQualification(db, event, { WX_OPENID: "openid-me" }, 3000);
  assert.equal(db.writes.length, 0);
  assert.equal((await handleQualification(db, { action: "getQualification" }, { WX_OPENID: "openid-me" })).status, "NOT_REQUIRED");
});

test("publishes two complete works without the former three-work minimum", async () => {
  const db = mockDb({ draft: {
    ...validDraft,
    services: [{ ...validDraft.services[0], workIds: ["work_1", "work_2"] }],
    works: validDraft.works.slice(0, 2)
  } });
  const result = await handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" });
  assert.equal(result.worksCount, 2);
  assert.equal(db.writes.length, 1);
});

test("publishes zero or one work while preserving media validation", async () => {
  for (const count of [0, 1]) {
    const draft = { ...validDraft, works: validDraft.works.slice(0, count), pinnedWorkIds: [],
      services: [{ ...validDraft.services[0], workIds: count ? ["work_1"] : [] }] };
    const db = mockDb({ draft });
    const result = await handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" });
    assert.equal(result.worksCount, count);
    assert.equal(JSON.parse(db.writes[0].value.payload).works.length, count);
    if (count) {
      const missing = mockDb({ draft, readyAssets: [] });
      await assert.rejects(handleProviderPublish(missing, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }), { code: "MEDIA_NOT_READY" });
      assert.equal(missing.writes.length, 0);
    }
  }
});

test("a zero-work catalog still validates its notice image ownership and purpose", async () => {
  const draft = { ...validDraft, works: [], pinnedWorkIds: [],
    services: [{ ...validDraft.services[0], workIds: [] }],
    profile: { ...validDraft.profile, noticeImageAssetId: ASSETS[0] } };
  for (const patch of [{ purpose: "WORK_IMAGE" }, { owner_account_id: "other" }, { status: "PENDING" }]) {
    const db = mockDb({ draft, readyAssets: [ASSETS[0]] });
    Object.assign(db.fixtures.media_assets[0], { purpose: "NOTICE_IMAGE" }, patch);
    await assert.rejects(handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }), { code: "MEDIA_NOT_READY" });
    assert.equal(db.writes.length, 0);
  }
  const db = mockDb({ draft, readyAssets: [ASSETS[0]] });
  db.fixtures.media_assets[0].purpose = "NOTICE_IMAGE";
  assert.equal((await handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" })).worksCount, 0);
});

test("rejects media that is not READY and owned by the provider", async () => {
  const db = mockDb({ readyAssets: ASSETS.slice(0, 2) });
  await assert.rejects(
    () => handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }),
    (error) => error.code === "MEDIA_NOT_READY" && error.details.missingAssetCount === 1
  );
  assert.equal(db.writes.length, 0);
});

test("rejects ready media used for the wrong catalog purpose", async () => {
  const db = mockDb();
  db.fixtures.media_assets[0].purpose = "AVATAR";
  await assert.rejects(
    () => handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }),
    (error) => error.code === "MEDIA_NOT_READY"
  );
  assert.equal(db.writes.length, 0);
});

test("rejects a stale draft version before public writes", async () => {
  const db = mockDb({ draftVersion: 4 });
  await assert.rejects(
    () => handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }),
    (error) => error.code === "VERSION_CONFLICT"
  );
  assert.equal(db.writes.length, 0);
});

test("republish preserves work identity and detects concurrent publication", async () => {
  const previousPayload = {
    works: [{ id: "work_1", code: "AM-EXISTING01", referenceCount: 9 }]
  };
  const publication = { payload: previousPayload, draft_version: 2, publication_version: 7, published_at: 100 };
  const db = mockDb({ publication });
  const result = await handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }, 3000);
  assert.equal(result.publicationVersion, 8);
  const payload = JSON.parse(db.writes[0].value.payload);
  assert.equal(payload.works[0].code, "AM-EXISTING01");
  assert.equal(payload.works[0].referenceCount, 9);

  const conflicted = mockDb({ publication, conflict: true });
  await assert.rejects(
    () => handleProviderPublish(conflicted, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }),
    (error) => error.code === "PUBLISH_CONFLICT"
  );
});

test("string database versions are normalized before publish and increment", async () => {
  const publication = { payload: { works: [] }, draft_version: "2", publication_version: "7", published_at: 100 };
  const db = mockDb({ draftVersion: "3", publication });
  const result = await handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }, 3000);
  assert.equal(result.draftVersion, 3);
  assert.equal(result.publicationVersion, 8);
  assert.equal(db.writes[0].value.publication_version, 8);
});

test('notice image cannot bypass work purpose check by appearing in both fields', async () => {
  const draft=JSON.parse(JSON.stringify(validDraft));draft.profile.noticeImageAssetId=ASSETS[0];
  const db=mockDb({draft});db.fixtures.media_assets[0].purpose='NOTICE_IMAGE';
  await assert.rejects(handleProviderPublish(db,{action:'publishDraft',expectedVersion:3},{WX_OPENID:'openid-me'}),{code:'MEDIA_NOT_READY'});
  assert.equal(db.writes.length,0);
});

test('watermarked publication also checks the original ownership, purpose and review state', async () => {
  const sourceId = 'asset_44444444444444444444444444444444';
  const draft = structuredClone(validDraft);
  draft.works[0].sourceImageAssetIds = [sourceId];
  draft.works[0].watermarks = [{ enabled: true, text: '@artist', position: 'bottom-right', size: 3, opacity: 60 }];
  for (const invalid of [{ owner_account_id: 'other' }, { purpose: 'AVATAR' }, { status: 'PENDING_SECURITY_REVIEW' }]) {
    const db = mockDb({ draft, readyAssets: [...ASSETS, sourceId] });
    Object.assign(db.fixtures.media_assets.find(asset => asset.id === sourceId), invalid);
    await assert.rejects(() => handleProviderPublish(db, { action: 'publishDraft', expectedVersion: 3 }, { WX_OPENID: 'openid-me' }), error => error.code === 'MEDIA_NOT_READY');
    assert.equal(db.writes.length, 0);
  }
});


test('service name review failure blocks publishDraft before any write', async () => {
 for(const code of ['SERVICE_NAME_REJECTED','SERVICE_NAME_CHECK_UNAVAILABLE']){
  const db=mockDb();let checked=false;
  await assert.rejects(handleProviderPublish(db,{action:'publishDraft',expectedVersion:3,draft:undefined},{WX_OPENID:'openid-me'},1234,{reviewServiceNames:async(services,openid)=>{checked=true;assert.equal(openid,'openid-me');assert.ok(services.some(item => item.name === validDraft.services[0].name));throw Object.assign(Error(code),{code});}}),{code});
  assert.equal(checked,true);assert.equal(db.writes.length,0);
 }
});

test('deferred publication uses the transactional worker with the exact owned snapshot', async () => {
 process.env.CONTENT_INTENTS_ENABLED='true';
 try {
  const db=mockDb();db.fixtures.media_assets[0].status='PENDING';let mutation;
  const dependencies={reviewServiceNames:async()=>{},mutatePublication:async input=>{mutation=input;return {queued:true,intentId:'task'};}};
  const result=await handleProviderPublish(db,{action:'publishDraft',expectedVersion:3},{WX_OPENID:'openid-me'},2000,dependencies);
  assert.equal(result.queued,true);assert.equal(mutation.owner,PROVIDER_ID);assert.equal(mutation.version,3);assert.equal(mutation.payload.assets.length,3);assert.equal(mutation.payload.previousPublicationVersion,0);assert.equal(db.writes.length,0);
  db.fixtures.media_assets[0].owner_account_id='other';mutation=null;
  await assert.rejects(handleProviderPublish(db,{action:'publishDraft',expectedVersion:3},{WX_OPENID:'openid-me'},2000,dependencies),{code:'MEDIA_NOT_READY'});assert.equal(mutation,null);
 } finally {delete process.env.CONTENT_INTENTS_ENABLED;}
});

test('案例参考价可留空，自选头图须属于本人且用途正确', async () => {
 const draft=structuredClone(validDraft);draft.works[0].priceFen=null;draft.profile.bannerAssetId='banner';
 const db=mockDb({draft});db.fixtures.media_assets.push({id:'banner',owner_account_id:PROVIDER_ID,purpose:'PROVIDER_BANNER',status:'READY'});
 await handleProviderPublish(db,{action:'publishDraft',expectedVersion:3},{WX_OPENID:'openid-me'},3000);
 const payload=JSON.parse(db.fixtures.provider_catalog_publications[0].payload);
 assert.equal(payload.works[0].priceFen,null);assert.equal(payload.profile.bannerAssetId,'banner');
 for(const change of [{purpose:'WORK_IMAGE'},{owner_account_id:'foreign'},{status:'PENDING'}]){
  const bad=mockDb({draft});bad.fixtures.media_assets.push({id:'banner',owner_account_id:PROVIDER_ID,purpose:'PROVIDER_BANNER',status:'READY',...change});
  await assert.rejects(handleProviderPublish(bad,{action:'publishDraft',expectedVersion:3},{WX_OPENID:'openid-me'}),{code:'MEDIA_NOT_READY'});
  assert.equal(bad.writes.length,0);
 }
});
test('所有公开文字都进入检测，单次请求不超过2000字', async () => {
 const draft=structuredClone(validDraft);draft.works[0].description='字'.repeat(2000);draft.works[0].creditPhoto='摄影师';draft.profile.declines='不承接';
 const chunks=[];const db=mockDb({draft});
 await handleProviderPublish(db,{action:'publishDraft',expectedVersion:3},{WX_OPENID:'openid-me'},3000,{reviewServiceNames:async rows=>chunks.push(rows.map(x=>x.name).join('\n'))});
 assert.ok(chunks.every(s=>s.length<=2000));assert.ok(chunks.join('\n').includes('摄影师'));assert.ok(chunks.join('\n').includes('不承接'));
});
