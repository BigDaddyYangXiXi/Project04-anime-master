const test = require("node:test");
const assert = require("node:assert/strict");
const { applyDiscovery, discoveryOptions, enrichCatalogMetrics, readCatalog } = require("./catalog-core");

test('opt-in work paging caps work count, spans author boundaries, and preserves legacy provider paging', async () => {
  for (const count of [0, 1, 49, 50, 51, 120]) {
    const works = Array.from({ length: count }, (_, index) => ({ id: `w${index}`, priceFen: 1, referenceCount: 0, imageAssetIds: [] }));
    const source = { accounts: ['a','b'].map(id => ({ id, status: 'ACTIVE' })), provider_catalog_publications: ['a','b'].map(id => ({
      provider_id: id, draft_version: 1, publication_version: 1, published_at: 1,
      payload: { profile: { career: '摄影', cityCode: '310000' },
        services: [{ id: 's', priceFen: 1, serviceMode: 'ONLINE', workIds: works.map(w => w.id) }], works }
    })) };
    const event = { action: 'listDiscovery', mode: 'works', cityCode: '310000', limit: 50, pageUnit: 'work' };
    const seen = []; let cursor;
    do {
      const result = await readCatalog(mockDb(source), { ...event, cursor });
      const entries = result.providers.flatMap(p => p.works.map(w => `${p.id}/${w.id}`));
      assert.ok(entries.length <= 50); assert.equal(result.total, count * 2);
      seen.push(...entries); cursor = result.nextCursor;
      assert.ok(seen.length <= count * 2);
    } while (cursor);
    assert.deepEqual(seen, ['a','b'].flatMap(id => works.map(w => `${id}/${w.id}`)));
    const legacy = await readCatalog(mockDb(source), { ...event, pageUnit: undefined, limit: 1 });
    assert.equal(legacy.providers[0]?.works.length || 0, count);
  }
  assert.throws(() => discoveryOptions({ mode: 'people', cityCode: '310000', pageUnit: 'work' }), { code: 'INVALID_ARGUMENT' });
});

test('discovery resolves media only for the returned page and matching works, retaining ownership checks', async () => {
  const source = { accounts: [], provider_catalog_publications: [], media_assets: [] };
  for (const id of ['a', 'b', 'c']) {
    source.accounts.push({ id, status: 'ACTIVE', avatar_asset_id: `${id}_avatar` });
    source.provider_catalog_publications.push({ provider_id: id, draft_version: 1, publication_version: 1, published_at: 100,
      payload: { profile: { career: '摄影', cityCode: '310000', noticeImageAssetId: `${id}_notice` },
        services: [{ id: 's', priceFen: 10, serviceMode: 'ONLINE', workIds: ['cheap', 'expensive'] }],
        works: [{ id: 'cheap', priceFen: 10, referenceCount: 0, imageAssetIds: [`${id}_work`, 'foreign', 'pending', 'external'] },
          { id: 'expensive', priceFen: 100, referenceCount: 0, imageAssetIds: [`${id}_extra`] }] } });
    for (const [suffix,purpose] of [['avatar','AVATAR'], ['notice','NOTICE_IMAGE'], ['work','WORK_IMAGE'], ['extra','WORK_IMAGE']]) {
      source.media_assets.push({ id: `${id}_${suffix}`, owner_account_id: id, purpose, status: 'READY', storage_key: `cloud://env/${id}_${suffix}` });
    }
  }
  source.media_assets.push(
    { id: 'foreign', owner_account_id: 'other', purpose: 'WORK_IMAGE', status: 'READY', storage_key: 'cloud://env/foreign' },
    { id: 'pending', owner_account_id: 'a', purpose: 'WORK_IMAGE', status: 'PENDING', storage_key: 'cloud://env/pending' },
    { id: 'external', owner_account_id: 'a', purpose: 'WORK_IMAGE', status: 'READY', storage_key: 'https://invalid.example/image' });
  for (const cursor of ['0', '1', '3']) {
    const reads = [];
    const result = await readCatalog(mockDb(source, reads), { action: 'listDiscovery', cityCode: '310000', mode: 'works', priceMaxFen: 10, limit: 1, cursor });
    assert.equal(result.total, 3);
    const media = reads.filter(r => r.table === 'media_assets');
    if (cursor === '3') { assert.equal(media.length, 0); assert.deepEqual(result.providers, []); continue; }
    const p = result.providers[0];
    assert.equal(media.length, 1);
    assert.deepEqual(media[0].data.map(m => m.id).sort(), [`${p.id}_avatar`, `${p.id}_notice`, `${p.id}_work`, `${p.id}_extra`, 'foreign', 'external'].sort());
    assert.equal(p.avatarFileId, `cloud://env/${p.id}_avatar`);
    assert.equal(p.noticeImageFileId, `cloud://env/${p.id}_notice`);
    assert.deepEqual(p.works[0].imageFileIds, [`cloud://env/${p.id}_work`]);
    assert.equal(p.works.length, 2);
  }
});

function mockDb(fixtures, reads = []) {
  return {
    from(table) {
      let data = fixtures[table] || [];
      const builder = {
        select() { return builder; },
        eq(column, value) { data = data.filter((item) => item[column] === value); return builder; },
        in(column, values) { data = data.filter((item) => values.includes(item[column])); return builder; },
        then(resolve) { reads.push({ table, data }); return Promise.resolve({ data, error: null }).then(resolve); }
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

test('目录列表的快照与旧公开资料首读并行，任一失败不返回部分目录', async () => {
  for (const fails of [false, true]) {
    const started = [], releases = {};
    const db = { from(table) {
      const query = { select() { return query; }, eq() { return query; },
        then(resolve, reject) {
          started.push(table);
          return new Promise((done, fail) => { releases[table] = () => fails && table === 'provider_profiles'
            ? fail(Error('unavailable')) : done({ data: [], error: null }); }).then(resolve, reject);
        }
      }; return query;
    } };
    const pending = readCatalog(db, { action: 'listProviders' });
    const outcome = pending.then(value => ({ value }), error => ({ error }));
    await new Promise(resolve => setImmediate(resolve));
    const concurrent = started.includes('provider_catalog_publications') && started.includes('provider_profiles');
    releases.provider_catalog_publications();
    await new Promise(resolve => setImmediate(resolve));
    releases.provider_profiles();
    const result = await outcome;
    assert.equal(concurrent, true, '首读不应等待快照读取完成才请求旧资料');
    if (fails) assert.equal(result.error?.message, 'unavailable');
    else assert.deepEqual(result.value, { providers: [] });
  }
});

test('作品价格筛选使用关联服务报价，案例参考价不影响可预约价格', () => {
  const catalog = { providers: [{ id: 'author', cityCode: '310000', tags: [],
    services: [{ id: 's', name: '服务关键词', description: '服务标签', priceFen: 80000, serviceMode: 'ONLINE' }],
    works: [{ id: 'cheap', serviceId: 's', title: '低价作品', priceFen: 50000, tags: ['作品标签'] },
      { id: 'expensive', serviceId: 's', title: '高价作品', priceFen: 250000, tags: [] }] }] };
  const query = extra => discoveryOptions({ cityCode: '310000', mode: 'works', ...extra });
  assert.deepEqual(applyDiscovery(catalog, query({ priceMaxFen: 99999 }))[0].works.map(w => w.id), ['cheap', 'expensive']);
  assert.deepEqual(applyDiscovery(catalog, query({ priceMinFen: 200000 })), []);
  assert.deepEqual(applyDiscovery(catalog, query({ tags: ['作品标签'] }))[0].works.map(w => w.id), ['cheap']);
  assert.deepEqual(applyDiscovery(catalog, query({ tags: ['服务标签'] })), []);
  assert.equal(applyDiscovery(catalog, query({ query: '服务关键词' }))[0].works.length, 2);
  assert.deepEqual(applyDiscovery(catalog, query({ query: '低价作品' }))[0].works.map(w => w.id), ['cheap']);
  assert.equal(applyDiscovery(catalog, query({ mode: 'people', priceMaxFen: 99999 }))[0].works.length, 2);
  assert.deepEqual(applyDiscovery(catalog, query({ mode: 'people', priceMinFen: 200000 })), []);
  assert.throws(() => query({ mode: 'invalid' }), { code: 'INVALID_ARGUMENT' });
});

test('同编号作品的参考次数按作者隔离，发现列表与详情一致', async () => {
  const source = { accounts: [], provider_catalog_publications: [], order_aggregates: [] };
  for (const [id, count] of [['provider_a', 2], ['provider_b', 1]]) {
    source.accounts.push({ id, status: 'ACTIVE' });
    source.provider_catalog_publications.push({ provider_id: id, draft_version: 1, publication_version: 1, published_at: 100,
      payload: { profile: { career: '妆娘', cityCode: '310000' },
        services: [{ id: 'service_1', priceFen: 100, serviceMode: 'ONLINE', workIds: ['shared_work'] }],
        works: [{ id: 'shared_work', priceFen: 100, referenceCount: 0, imageAssetIds: [] }] } });
    for (let index = 0; index < count; index += 1) source.order_aggregates.push({ provider_id: id, stage: 'COMPLETED',
      payload: { public: { buyerAgreementConfirmedAt: 1, referenceWorkId: 'shared_work' } } });
  }
  const discovery = await readCatalog(mockDb(source), { action: 'listDiscovery', cityCode: '310000' });
  for (const [id, count] of [['provider_a', 2], ['provider_b', 1]]) {
    assert.equal(discovery.providers.find(provider => provider.id === id).works[0].referenceCount, count);
    const detail = await readCatalog(mockDb(source), { action: 'getWork', providerId: id, workId: 'shared_work' });
    assert.equal(detail.work.referenceCount, count);
  }
});

test('发现页资格读取不阻塞独立的档期和订单查询，返回前仍等待资格', async () => {
  const source = structuredClone(fixtures);
  source.provider_catalog_publications = [{ provider_id: 'provider_1', draft_version: 1, publication_version: 1, published_at: 100,
    payload: { profile: { career: '妆娘', cityCode: '310000' }, services: [{ id: 'service_1', priceFen: 100, serviceMode: 'ONLINE' }], works: [] } }];
  source.provider_qualifications = [{ provider_id: 'provider_1', career: '妆娘', status: 'APPROVED', eligibility_verified: 1 }];
  const reads = [], db = mockDb(source, reads), originalFrom = db.from;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  db.from = table => {
    const builder = originalFrom(table), originalThen = builder.then;
    if (table === 'provider_qualifications') builder.then = (...args) => gate.then(() => originalThen.apply(builder, args));
    return builder;
  };
  let settled = false;
  const pending = readCatalog(db, { action: 'listDiscovery', cityCode: '310000', date: '2026-09-29' }).finally(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(settled, false);
    assert.ok(reads.some(read => read.table === 'provider_availability'));
    assert.ok(reads.some(read => read.table === 'order_aggregates'));
  } finally { release(); }
  assert.equal((await pending).providers[0].accepting, true);
});

test('存在损坏的新发布快照时，不得恢复旧版本目录或作品', async () => {
  for (const payload of ['{', null, { profile: {}, works: [] }]) {
    const source = structuredClone(fixtures);
    source.provider_catalog_publications = [{ provider_id: 'provider_1', payload, draft_version: 1, publication_version: 2, published_at: 100 }];
    assert.deepEqual(await readCatalog(mockDb(source), { action: 'getProvider', providerId: 'provider_1' }), { provider: null });
    assert.deepEqual(await readCatalog(mockDb(source), { action: 'getWork', workId: 'work_1' }), { work: null });
    assert.deepEqual(await readCatalog(mockDb(source), { action: 'listProviders' }), { providers: [] });
  }
});

test('已使用发布快照的详情不读取旧目录，空作品快照不恢复旧作品', async () => {
  const source = structuredClone(fixtures);
  source.provider_catalog_publications = [{ provider_id: 'provider_1', payload: { profile: { career: '妆娘' }, services: [], works: [] }, draft_version: 1, publication_version: 2, published_at: 100 }];
  const reads = [];
  const { provider } = await readCatalog(mockDb(source, reads), { action: 'getProvider', providerId: 'provider_1' });
  assert.deepEqual(provider.works, []);
  assert.equal(reads.some(read => ['provider_profiles', 'provider_services', 'works', 'work_tags', 'service_works', 'provider_pinned_works'].includes(read.table)), false);
});

test('作品编号在不同公开作者间冲突时不得选择第一位作者', async () => {
  const source = structuredClone(fixtures);
  source.accounts.push({ ...source.accounts[0], id: 'provider_2', uid: 'second' });
  source.provider_catalog_publications = ['provider_1', 'provider_2'].map(provider_id => ({
    provider_id, draft_version: 1, publication_version: 1, published_at: 100,
    payload: { profile: { career: '妆娘' }, services: [], works: [{ id: 'work_1', title: '同编号作品', priceFen: 100, referenceCount: 0, imageAssetIds: [] }] }
  }));
  const listing = await readCatalog(mockDb(source), { action: 'listProviders' });
  assert.equal(listing.providers.length, 2);
  assert.ok(listing.providers.every(provider => provider.works.length === 1));
  const reads = [];
  assert.deepEqual(await readCatalog(mockDb(source, reads), { action: 'getWork', workId: 'work_1' }), { work: null });
  assert.equal(reads.some(read => read.table === 'order_aggregates'), false);
  source.provider_catalog_publications.reverse();
  assert.deepEqual(await readCatalog(mockDb(source), { action: 'getWork', workId: 'work_1' }), { work: null });
  const scopedReads = [];
  const scoped = await readCatalog(mockDb(source, scopedReads), { action: 'getWork', workId: 'work_1', providerId: 'provider_2' });
  assert.equal(scoped.work.providerId, 'provider_2');
  assert.equal(scoped.work.provider.id, 'provider_2');
  assert.deepEqual(scopedReads.find(read => read.table === 'provider_catalog_publications').data.map(row => row.provider_id), ['provider_2']);
  assert.deepEqual(await readCatalog(mockDb(source), { action: 'getWork', workId: 'work_1', providerId: 'missing' }), { work: null });
  const invalidReads = [];
  await assert.rejects(readCatalog(mockDb(source, invalidReads), { action: 'getWork', workId: 'work_1', providerId: '../bad' }), { code: 'INVALID_ARGUMENT' });
  assert.equal(invalidReads.length, 0);
});

test("列表只返回已发布且账号正常的目录数据", async () => {
  const result = await readCatalog(mockDb(fixtures), { action: "listProviders" });
  assert.equal(result.providers.length, 1);
  assert.equal(result.providers[0].nickname, "南烛");
  assert.equal(result.providers[0].services[0].priceFen, 52000);
  assert.deepEqual(result.providers[0].pinnedWorkIds, ["work_1"]);
  assert.equal(result.providers[0].works[0].serviceId, "service_1");
});

test("public booking availability ignores onboarding approval but preserves suspension", async () => {
  const source = structuredClone(fixtures);
  let result = await readCatalog(mockDb(source), { action: "listProviders" });
  assert.equal(result.providers[0].accepting, true);
  const provider = result.providers[0];
  source.provider_qualifications = [{ provider_id: provider.id, career: provider.career, status: "APPROVED", eligibility_verified: 1 }];
  result = await readCatalog(mockDb(source), { action: "listProviders" });
  assert.equal(result.providers[0].accepting, true);
  for (const status of ["PENDING", "REJECTED"]) {
    source.provider_qualifications[0].status = status;
    source.provider_qualifications[0].career = "其他职业";
    source.provider_qualifications[0].eligibility_verified = 0;
    result = await readCatalog(mockDb(source), { action: "listProviders" });
    assert.equal(result.providers[0].accepting, true);
  }
  source.provider_qualifications[0].status = "SUSPENDED";
  result = await readCatalog(mockDb(source), { action: "listProviders" });
  assert.equal(result.providers[0].accepting, false);
});

test("详情不存在时返回 null，不泄露草稿", async () => {
  const hidden = JSON.parse(JSON.stringify(fixtures));
  hidden.works[0].status = "DRAFT";
  const result = await readCatalog(mockDb(hidden), { action: "getWork", workId: "work_1" });
  assert.equal(result.work, null);
});

test("作品关联服务来自当前作者的有效服务，解除关联后不残留", async () => {
  const linked = await readCatalog(mockDb(fixtures), { action: "getWork", workId: "work_1" });
  assert.equal(linked.work.service.id, "service_1");
  assert.equal(linked.work.service.priceFen, 52000);
  assert.equal(linked.work.service.description, "说明");
  for (const changes of [
    { service_works: [] },
    { provider_services: [{ ...fixtures.provider_services[0], status: "INACTIVE" }] },
    { service_works: [{ ...fixtures.service_works[0], service_id: "other_provider_service" }] }
  ]) {
    const result = await readCatalog(mockDb({ ...fixtures, ...changes }), { action: "getWork", workId: "work_1" });
    assert.equal(result.work.service, null);
  }
});

test("拒绝未知动作和非法 ID", async () => {
  await assert.rejects(() => readCatalog(mockDb(fixtures), { action: "deleteAll" }), (error) => error.code === "INVALID_ACTION");
  await assert.rejects(() => readCatalog(mockDb(fixtures), { action: "getProvider", providerId: "x' OR 1=1" }), (error) => error.code === "INVALID_ARGUMENT");
});

test("详情和发现条件非法时不读取任何目录数据", async () => {
  for (const event of [{ action: 'getProvider', providerId: "x' OR 1=1" },
    { action: 'getWork', workId: '../private' }, { action: 'listDiscovery', cityCode: 'invalid' }]) {
    const db = { from() { assert.fail('invalid input must not query database'); } };
    await assert.rejects(readCatalog(db, event), { code: 'INVALID_ARGUMENT' });
  }
});

test("创作者详情只加载目标创作者，保留快照优先及旧目录兼容", async () => {
  const source = structuredClone(fixtures);
  source.accounts.push({ ...source.accounts[0], id: 'provider_other' });
  source.provider_profiles.push({ ...source.provider_profiles[0], provider_id: 'provider_other' });
  source.provider_catalog_publications = [{ provider_id: 'provider_other', draft_version: 1,
    publication_version: 1, published_at: 100, payload: { profile: { career: '摄影' }, services: [], works: [] } }];
  const reads = [];
  const { provider } = await readCatalog(mockDb(source, reads), { action: 'getProvider', providerId: 'provider_1' });
  assert.equal(provider.id, 'provider_1');
  assert.equal(provider.services[0].id, 'service_1');
  assert.equal(provider.works[0].id, 'work_1');
  assert.equal(reads.some(read => read.data.some(row => row.provider_id === 'provider_other' || row.id === 'provider_other')), false);
  const absent = [];
  assert.deepEqual(await readCatalog(mockDb(source, absent), { action: 'getProvider', providerId: 'missing' }), { provider: null });
  assert.equal(absent.some(read => read.table === 'order_aggregates'), false);
});

test("完整主页字段公开回读保留，评价只返回公开正文和回复", async () => {
  const data = structuredClone(fixtures);
  data.provider_catalog_publications = [{ provider_id: "provider_1", draft_version: 1, publication_version: 1, published_at: 100, payload: {
    profile: { career: "妆娘", city: "杭州", district: "余杭区", cityCode: "330100", accepting: false, specialties: "自然妆", declines: "特效妆", contactHours: "晚间", bio: "简介", notice: "须知", tags: [] },
    services: [{ id: "s1", name: "跟妆", priceFen: 36000, unit: "次", description: "4小时", includes: "补妆", extras: "交通另议", preparation: "素颜", workIds: [] }], works: [], pinnedWorkIds: []
  } }];
  data.order_aggregates = [{ provider_id: "provider_1", stage: "COMPLETED", created_at: 1, payload: { public: { rating: 5, reviewText: "满意", reviewReply: "谢谢", requirement: "非公开需求", contact: { phone: "不应返回" } } } }];
  const { provider } = await readCatalog(mockDb(data), { action: "getProvider", providerId: "provider_1" });
  assert.equal(provider.district, "余杭区"); assert.equal(provider.accepting, false); assert.equal(provider.specialties, "自然妆"); assert.equal(provider.contactHours, "晚间");
  assert.equal(provider.services[0].includes, "补妆"); assert.equal(provider.services[0].extras, "交通另议"); assert.equal(provider.services[0].preparation, "素颜"); assert.equal(provider.services[0].priceFen, 36000);
  assert.deepEqual(provider.reviews, [{ rating: 5, text: "满意", reply: "谢谢" }]);
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

test('发现先筛选职业和服务范围，再读取候选人的档期与订单，排序分页保持一致', async () => {
  const source = { accounts: [], provider_catalog_publications: [], order_aggregates: [], provider_availability: [] };
  for (const [id, career, cityCode, rating] of [['local', '摄影', '310000', 4], ['online', '摄影', '330100', 5], ['outside', '摄影', '440100', 5], ['other-career', '妆娘', '310000', 5]]) {
    source.accounts.push({ id, status: 'ACTIVE', nickname: id });
    source.provider_catalog_publications.push({ provider_id: id, draft_version: 1, publication_version: 1, published_at: 100, payload: {
      profile: { career, cityCode, tags: [] }, services: [{ id: `${id}_service`, priceFen: 10000, serviceMode: id === 'online' ? 'ONLINE' : 'ONSITE', name: '夜景', workIds: [] }], works: []
    } });
    source.order_aggregates.push({ provider_id: id, stage: 'COMPLETED', created_at: 100, payload: { public: { rating, timeSegments: [] } } });
    source.provider_availability.push({ provider_id: id, payload: { openDates: ['2026-09-25'] } });
  }
  const event = { action: 'listDiscovery', cityCode: '310000', career: '摄影', date: '2026-09-25', query: '夜景', limit: 1 };
  const { providers } = await readCatalog(mockDb(source), { action: 'listProviders' });
  const expected = applyDiscovery(enrichCatalogMetrics({ providers }, source.order_aggregates), discoveryOptions(event), source.provider_availability, source.order_aggregates);
  const reads = [];
  const result = await readCatalog(mockDb(source, reads), event);
  assert.deepEqual(result.providers, expected.slice(0, 1));
  assert.equal(result.total, expected.length); assert.equal(result.nextCursor, '1');
  for (const read of reads.filter(item => ['provider_availability', 'order_aggregates'].includes(item.table))) {
    assert.deepEqual(read.data.map(row => row.provider_id).sort(), ['local', 'online']);
  }
  const emptyReads = [];
  const empty = await readCatalog(mockDb(source, emptyReads), { ...event, query: '没有匹配的词' });
  assert.equal(empty.total, 0);
  assert.equal(emptyReads.some(item => ['provider_availability', 'order_aggregates'].includes(item.table)), false);
});

test("发现参数拒绝不存在的日期并保留同组任选语义", () => {
  assert.throws(() => discoveryOptions({ cityCode: "310000", date: "2026-02-30" }), (error) => error.code === "INVALID_ARGUMENT");
  assert.throws(() => discoveryOptions({ cityCode: "310104" }), (error) => error.code === "INVALID_ARGUMENT");
  assert.deepEqual(discoveryOptions({ cityCode: "310000", tagGroups: [["棚拍", "夜景"], ["电影光"]] }).tagGroups, [["棚拍", "夜景"], ["电影光"]]);
});

test('one structurally damaged publication cannot break other public providers or revive its legacy works', async () => {
  const base = { profile: {}, services: [], works: [] };
  for (const payload of [
    { ...base, works: [null] }, { ...base, services: [null] },
    { ...base, works: [{ id: 'bad', imageAssetIds: 'private-path' }] },
    { ...base, services: [{ id: 'bad', workIds: 'work_1' }] },
    { ...base, services: [{ id: 'bad', priceFen: 1, serviceAreas: [null] }] },
    { ...base, pinnedWorkIds: {} },
    { ...base, works: [{ id: 'bad', priceFen: -1, referenceCount: 0 }] }
  ]) {
    const source = structuredClone(fixtures);
    source.accounts.push({ id: 'healthy', status: 'ACTIVE', nickname: 'Healthy' });
    source.provider_catalog_publications = [
      { provider_id: 'provider_1', payload, draft_version: 1, publication_version: 1, published_at: 1 },
      { provider_id: 'healthy', payload: base, draft_version: 1, publication_version: 1, published_at: 1 }
    ];
    const result = await readCatalog(mockDb(source), { action: 'listProviders' });
    assert.deepEqual(result.providers.map(p => p.id), ['healthy']);
    assert.deepEqual(await readCatalog(mockDb(source), { action: 'getWork', workId: 'work_1' }), { work: null });
  }
});

test('valid work identifiers matching Object prototype names retain numeric reference counts', () => {
  const catalog = { providers: [{ id: 'provider', works: ['__proto__', 'constructor', 'toString'].map(id => ({ id, referenceCount: 0 })) }] };
  const orders = catalog.providers[0].works.map(work => ({ provider_id: 'provider', stage: 'COMPLETED', created_at: 1,
    payload: { public: { buyerAgreementConfirmedAt: 2, referenceWorkId: work.id } } }));
  const result = enrichCatalogMetrics(catalog, orders);
  assert.deepEqual(result.providers[0].works.map(w => w.referenceCount), [1, 1, 1]);
});

test('invalid discovery numeric input is a public argument error before database access', async () => {
  for (const [field, value] of [['priceMinFen', -1], ['priceMaxFen', true], ['limit', 0], ['limit', 1.5], ['cursor', {}], ['cursor', -1]]) {
    const reads = [];
    await assert.rejects(() => readCatalog(mockDb(fixtures, reads), { action: 'listDiscovery', cityCode: '330100', [field]: value }), { code: 'INVALID_ARGUMENT' });
    assert.deepEqual(reads, []);
  }
});

test('invalid catalog request envelopes are rejected without database access', async () => {
  for (const event of [null, [], 'listProviders']) {
    const reads = [];
    await assert.rejects(() => readCatalog(mockDb(fixtures, reads), event), { code: 'INVALID_ARGUMENT' });
    assert.deepEqual(reads, []);
  }
});


test('nearest city fallback excludes suspended providers and uses distance, never city code ordering',async()=>{
 const source={accounts:[],provider_catalog_publications:[],provider_qualifications:[]};
 for(const [id,code,works,approved] of [['near','330100',0,true],['blocked','320500',1,false],['far','320100',1,true]]){
  source.accounts.push({id,status:'ACTIVE',nickname:id});
  source.provider_qualifications.push({provider_id:id,career:'摄影',status:approved?'APPROVED':'SUSPENDED',eligibility_verified:approved?1:0});
  source.provider_catalog_publications.push({provider_id:id,draft_version:1,publication_version:1,published_at:100,payload:{profile:{career:'摄影',cityCode:code},services:[{id:'s',priceFen:100,serviceMode:'ONSITE',workIds:works?['w']:[]}],works:works?[{id:'w',title:id,priceFen:100,referenceCount:0,imageAssetIds:[]}]:[]}});
 }
 const cities=[['310000','上海市',31.2,121.5],['330100','杭州市',30.2,120.1],['320500','苏州市',31.3,120.6],['320100','南京市',32.1,118.8]].map(([cityCode,cityName,latitude,longitude])=>({cityCode,cityName,latitude,longitude,provinceName:'测试省'}));
 const event={action:'listDiscovery',cityCode:'310000',career:'摄影',mode:'works',nearest:true,serviceableOnly:true};
 source.media_assets=[];
 for(const publication of source.provider_catalog_publications){
  for(const work of publication.payload.works){
   const id=publication.provider_id+'_image';work.imageAssetIds=[id];
   source.media_assets.push({id,owner_account_id:publication.provider_id,purpose:'WORK_IMAGE',status:'READY',storage_key:'cloud://env/'+id});
  }
 }
 const reads=[];
 const result=await readCatalog(mockDb(source,reads),event,{resolveCities:async()=>cities});
 assert.equal(result.region.cityCode,'320100');assert.equal(result.providers.length,1);assert.equal(result.providers[0].id,'far');assert.equal(result.fallbackFrom,'310000');
 assert.deepEqual(result.providers[0].works[0].imageFileIds,['cloud://env/far_image']);
 assert.deepEqual(reads.filter(r=>r.table==='media_assets').map(r=>r.data.map(m=>m.id)),[['far_image']]);
 const local=await readCatalog(mockDb(source),{...event,cityCode:'320100'},{resolveCities:()=>assert.fail('local content must not query cities')});assert.equal(local.providers.length,1);assert.equal(local.region,undefined);
 const failed=await readCatalog(mockDb(source),event,{resolveCities:async()=>{throw Error('offline')}});assert.equal(failed.nearbyUnavailable,true);assert.equal(failed.region,undefined);
 const empty=await readCatalog(mockDb({}),event,{resolveCities:()=>assert.fail('no works anywhere must not query cities')});assert.equal(empty.providers.length,0);
});

test('public catalog exposes credits and display images, never original asset ids or watermark settings', async () => {
  const work = { id:'w', title:'作品', priceFen:100, referenceCount:0, imageAssetIds:['display'], sourceImageAssetIds:['private-original'], watermarks:[{text:'@author'}], creditPhoto:'摄影老师', creditMine:'妆造' };
  const source = { accounts:[{id:'p',status:'ACTIVE'}], provider_catalog_publications:[{provider_id:'p',draft_version:1,publication_version:1,published_at:1,payload:{profile:{career:'妆娘'},services:[],works:[work]}}], media_assets:[{id:'display',owner_account_id:'p',purpose:'WORK_IMAGE',storage_key:'cloud://display',status:'READY'}] };
  const { loadPublicationCatalog } = require('./catalog-core');
  const result = await loadPublicationCatalog(mockDb(source),'p');
  const publicWork = result.providers[0].works[0];
  assert.equal(publicWork.creditPhoto,'摄影老师');
  assert.equal(JSON.stringify(result).includes('private-original'),false);
  assert.equal(Object.hasOwn(publicWork,'watermarks'),false);
});


test('详情资格与订单统计并行，返回等待资格且失败不返回部分结果', async () => {
 for (const action of ['getProvider','getWork']) for (const fails of [false,true]) {
  const source=structuredClone(fixtures);
  source.provider_qualifications=[{provider_id:'provider_1',career:'妆娘',status:'APPROVED',eligibility_verified:1}];
  const reads=[],db=mockDb(source,reads),originalFrom=db.from;let release,settled=false;
  const gate=new Promise(resolve=>release=resolve);
  db.from=table=>{const builder=originalFrom(table),then=builder.then;
   if(table==='provider_qualifications')builder.then=(resolve,reject)=>gate.then(()=>{
    if(fails)throw Error('qualification unavailable');
    return then.call(builder,x=>x);
   }).then(resolve,reject);return builder;};
  const pending=readCatalog(db,{action,providerId:'provider_1',workId:'work_1'});
  const outcome=pending.then(value=>({value}),error=>({error})).finally(()=>{settled=true;});
  await new Promise(resolve=>setImmediate(resolve));
  const concurrent=reads.some(read=>read.table==='order_aggregates'),premature=settled;
  release();const result=await outcome;
  assert.equal(concurrent,true,action+' should start orders before qualifications finish');assert.equal(premature,false);
  if(fails){assert.equal(result.error?.message,'qualification unavailable');assert.equal(result.value,undefined);}
  else {assert.equal(result.error,undefined);assert.equal((result.value.provider||result.value.work.provider).accepting,true);}
 }
});
