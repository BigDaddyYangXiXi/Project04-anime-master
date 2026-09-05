const test = require("node:test");
const assert = require("node:assert/strict");
const { handleProviderPublish } = require("./publication-core");

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

test("returns actionable missing fields for an incomplete catalog", async () => {
  const db = mockDb({ draft: {
    ...validDraft,
    services: [{ ...validDraft.services[0], workIds: ["work_1", "work_2"] }],
    works: validDraft.works.slice(0, 2)
  } });
  await assert.rejects(
    () => handleProviderPublish(db, { action: "publishDraft", expectedVersion: 3 }, { WX_OPENID: "openid-me" }),
    (error) => error.code === "PUBLISH_VALIDATION_FAILED" && error.details.missingFields.includes("works:min3")
  );
  assert.equal(db.writes.length, 0);
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
