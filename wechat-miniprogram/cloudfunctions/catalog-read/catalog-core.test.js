const test = require("node:test");
const assert = require("node:assert/strict");
const { applyDiscovery, discoveryOptions, enrichCatalogMetrics, readCatalog } = require("./catalog-core");

function mockDb(fixtures) {
  return {
    from(table) {
      let data = fixtures[table] || [];
      const builder = {
        select() { return builder; },
        eq(column, value) { data = data.filter((item) => item[column] === value); return builder; },
        in(column, values) { data = data.filter((item) => values.includes(item[column])); return builder; },
        then(resolve) { return Promise.resolve({ data, error: null }).then(resolve); }
      };
      return builder;
    }
  };
}

const fixtures = {
  accounts: [{ id: "provider_1", uid: "nanzhu", nickname: "南烛", avatar_asset_id: null, status: "ACTIVE" }],
  provider_profiles: [{ provider_id: "provider_1", career: "妆娘", city: "杭州", bio: "简介", notice: "须知", notice_image_asset_id: null, publish_status: "PUBLISHED", published_at: 10, version: 1 }],
  provider_profile_tags: [{ provider_id: "provider_1", tag: "骨相调整", sort_order: 0 }],
  provider_services: [{ id: "service_1", provider_id: "provider_1", name: "角色妆造", price_fen: 52000, unit: "人次", description: "说明", status: "ACTIVE", sort_order: 0 }],
  works: [{ id: "work_1", provider_id: "provider_1", code: "AM-MU-1", title: "夜航者", subtitle: "男性角色妆", price_fen: 52000, description: "作品说明", tone: "coral", status: "PUBLISHED", reference_count: 31, published_at: 11, version: 1 }],
  work_tags: [{ work_id: "work_1", tag: "男角", sort_order: 0 }],
  service_works: [{ work_id: "work_1", service_id: "service_1", provider_id: "provider_1", sort_order: 0 }],
  provider_pinned_works: [{ provider_id: "provider_1", work_id: "work_1", position: 1 }]
};

test("列表只返回已发布且账号正常的目录数据", async () => {
  const result = await readCatalog(mockDb(fixtures), { action: "listProviders" });
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0].nickname, "南烛");
  assert.equal(result.providers[0].services[0].priceFen, 52000);
  assert.deepEqual(result.providers[0].pinnedWorkIds, ["work_1"]);
  assert.equal(result.providers[0].works[0].serviceId, "service_1");
});

test("详情不存在时返回 null，不泄露草稿", async () => {
  const hidden = JSON.parse(JSON.stringify(fixtures));
  hidden.works[0].status = "DRAFT";
  const result = await readCatalog(mockDb(hidden), { action: "getWork", workId: "work_1" });
  assert.equal(result.work, null);
});

test("拒绝未知动作和非法 ID", async () => {
  await assert.rejects(() => readCatalog(mockDb(fixtures), { action: "deleteAll" }), (error) => error.code === "INVALID_ACTION");
  await assert.rejects(() => readCatalog(mockDb(fixtures), { action: "getProvider", providerId: "x' OR 1=1" }), (error) => error.code === "INVALID_ARGUMENT");
});

test("公开快照存在时优先读取单行快照并保留媒体引用", async () => {
  const snapshotFixtures = JSON.parse(JSON.stringify(fixtures));
  snapshotFixtures.accounts[0].nickname = "新昵称";
  snapshotFixtures.accounts[0].avatar_asset_id = "asset_avatar";
  snapshotFixtures.provider_catalog_publications = [{
    provider_id: "provider_1",
    draft_version: "7",
    publication_version: "3",
    published_at: "99",
    payload: {
      schemaVersion: 1,
      profile: { career: "摄影师", city: "上海", bio: "新简介", notice: "新须知", tags: ["棚拍"], noticeImageAssetId: "asset_notice" },
      services: [{ id: "service_new", name: "正片", priceFen: "88000", unit: "套", description: "服务说明", workIds: ["work_new"] }],
      works: [{ id: "work_new", title: "新作品", subtitle: "", priceFen: "88000", description: "新说明", tone: "coral", tags: ["棚拍"], imageAssetIds: ["asset_1"], code: "AM-NEW", referenceCount: "4" }],
      pinnedWorkIds: ["work_new", "draft_only"]
    }
  }];
  snapshotFixtures.media_assets = [
    { id: "asset_avatar", owner_account_id: "provider_1", purpose: "AVATAR", storage_key: "cloud://env.bucket/avatar.png", status: "READY" },
    { id: "asset_1", owner_account_id: "provider_1", purpose: "WORK_IMAGE", storage_key: "cloud://env.bucket/work.png", status: "READY" },
    { id: "asset_notice", owner_account_id: "provider_1", purpose: "NOTICE_IMAGE", storage_key: "cloud://env.bucket/notice.png", status: "READY" }
  ];

  const result = await readCatalog(mockDb(snapshotFixtures), { action: "getProvider", providerId: "provider_1" });
  assert.equal(result.provider.nickname, "新昵称");
  assert.equal(result.provider.version, 3);
  assert.equal(result.provider.draftVersion, 7);
  assert.equal(result.provider.publishedAt, 99);
  assert.equal(result.provider.services[0].priceFen, 88000);
  assert.equal(result.provider.works[0].referenceCount, 4);
  assert.equal(result.provider.avatarFileId, "cloud://env.bucket/avatar.png");
  assert.deepEqual(result.provider.pinnedWorkIds, ["work_new"]);
  assert.equal(result.provider.works[0].serviceId, "service_new");
  assert.deepEqual(result.provider.works[0].imageAssetIds, ["asset_1"]);
  assert.deepEqual(result.provider.works[0].imageFileIds, ["cloud://env.bucket/work.png"]);
  assert.equal(result.provider.noticeImageFileId, "cloud://env.bucket/notice.png");
  assert.equal(result.provider.works.some((work) => work.id === "work_1"), false);
});

test("公开读取不会把错误归属或用途的媒体解析成图片地址", async () => {
  const snapshotFixtures = JSON.parse(JSON.stringify(fixtures));
  snapshotFixtures.accounts[0].avatar_asset_id = "asset_avatar";
  snapshotFixtures.provider_catalog_publications = [{
    provider_id: "provider_1", draft_version: 1, publication_version: 1, published_at: 99,
    payload: { schemaVersion: 1, profile: { career: "摄影", city: "上海", bio: "", notice: "", tags: [], noticeImageAssetId: null }, services: [], works: [], pinnedWorkIds: [] }
  }];
  snapshotFixtures.media_assets = [{ id: "asset_avatar", owner_account_id: "other", purpose: "AVATAR", storage_key: "cloud://env.bucket/wrong.png", status: "READY" }];
  const result = await readCatalog(mockDb(snapshotFixtures), { action: "getProvider", providerId: "provider_1" });
  assert.equal(result.provider.avatarFileId, null);
});

test("快照迁移按服务方覆盖而不是让全部旧目录消失", async () => {
  const mixed = JSON.parse(JSON.stringify(fixtures));
  mixed.accounts.push({ id: "provider_2", uid: "legacy", nickname: "旧目录服务方", avatar_asset_id: null, status: "ACTIVE" });
  mixed.provider_profiles.push({ provider_id: "provider_2", career: "后期", city: "上海", bio: "旧简介", notice: "", notice_image_asset_id: null, publish_status: "PUBLISHED", published_at: 8, version: 1 });
  mixed.provider_services.push({ id: "service_2", provider_id: "provider_2", name: "后期", price_fen: 30000, unit: "条", description: "说明", status: "ACTIVE", sort_order: 0 });
  mixed.works.push({ id: "work_2", provider_id: "provider_2", code: "AM-OLD", title: "旧作品", subtitle: "", price_fen: 30000, description: "说明", tone: "coral", status: "PUBLISHED", reference_count: 0, published_at: 8, version: 1 });
  mixed.service_works.push({ work_id: "work_2", service_id: "service_2", provider_id: "provider_2", sort_order: 0 });
  mixed.provider_catalog_publications = [{ provider_id: "provider_1", draft_version: 1, publication_version: 1, published_at: 99, payload: {
    profile: { career: "妆娘", city: "杭州", cityCode: "330100", bio: "新简介", notice: "", tags: [] },
    services: [], works: [], pinnedWorkIds: []
  } }];
  const result = await readCatalog(mockDb(mixed), { action: "listProviders" });
  assert.deepEqual(result.providers.map((provider) => provider.id).sort(), ["provider_1", "provider_2"]);
  assert.equal(result.providers.find((provider) => provider.id === "provider_1").bio, "新简介");
  assert.equal(result.providers.find((provider) => provider.id === "provider_2").works[0].id, "work_2");
});

test("发现流按城市服务能力、分组标签和档期排序", () => {
  const catalog = { providers: [
    { id: "online", career: "摄影", cityCode: "330100", nickname: "线上", bio: "", tags: [], publishedAt: 30, services: [{ id: "s2", name: "后期", description: "棚拍 电影光", priceFen: 80000, serviceMode: "ONLINE", serviceAreas: [] }], works: [] },
    { id: "local", career: "摄影", cityCode: "310000", nickname: "本地", bio: "", tags: [], publishedAt: 20, services: [{ id: "s1", name: "正片", description: "夜景 电影光", priceFen: 120000, serviceMode: "ONSITE", serviceAreas: [] }], works: [] },
    { id: "outside", career: "摄影", cityCode: "440100", nickname: "外地", bio: "", tags: [], publishedAt: 40, services: [{ id: "s3", name: "正片", description: "夜景 电影光", priceFen: 100000, serviceMode: "ONSITE", serviceAreas: [] }], works: [] }
  ], works: [] };
  const options = discoveryOptions({ cityCode: "310000", career: "摄影", date: "2026-09-20", tagGroups: [["棚拍", "夜景"], ["电影光"]], limit: 20 });
  const matched = applyDiscovery(catalog, options, [{ provider_id: "local", payload: { openDates: ["2026-09-20"] } }], []);
  assert.deepEqual(matched.map((item) => item.id), ["local", "online"]);
  assert.equal(matched[0].discovery.locationMatch, "LOCAL");
  assert.equal(matched[0].discovery.availabilityState, "OPEN");
});

test("发现流指标只从订单事实聚合", () => {
  const catalog = { providers: [{ id: "provider_1", services: [], works: [{ id: "work_1", referenceCount: 0 }] }], works: [] };
  const enriched = enrichCatalogMetrics(catalog, [
    { provider_id: "provider_1", stage: "COMPLETED", created_at: 1000, payload: { public: { rating: 5, buyerAgreementConfirmedAt: 1, contactFirstCopiedAt: 1801000, referenceWorkId: "work_1" } } },
    { provider_id: "provider_1", stage: "COMPLETED", created_at: 1000, payload: { public: { rating: 4, buyerAgreementConfirmedAt: 2, contactFirstCopiedAt: 3601000, referenceWorkId: "work_1" } } },
    { provider_id: "provider_1", stage: "REQUESTED", payload: { public: { rating: 0, referenceWorkId: "work_1" } } }
  ]);
  assert.equal(enriched.providers[0].orders, 2);
  assert.equal(enriched.providers[0].rating, 4.5);
  assert.equal(enriched.providers[0].reviewCount, 2);
  assert.equal(enriched.providers[0].works[0].referenceCount, 2);
  assert.equal(enriched.providers[0].averageResponseMinutes, 45);
  assert.equal(enriched.providers[0].responseSampleCount, 2);
});

test("发现参数拒绝不存在的日期并保留同组任选语义", () => {
  assert.throws(() => discoveryOptions({ cityCode: "310000", date: "2026-02-30" }), (error) => error.code === "INVALID_ARGUMENT");
  assert.throws(() => discoveryOptions({ cityCode: "310104" }), (error) => error.code === "INVALID_ARGUMENT");
  assert.deepEqual(discoveryOptions({ cityCode: "310000", tagGroups: [["棚拍", "夜景"], ["电影光"]] }).tagGroups, [["棚拍", "夜景"], ["电影光"]]);
});
