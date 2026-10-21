const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const mysql = require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
const { publishedWorkCandidatesQuery } = require('../scripts/catalog-publication-query');
const { loadPublicationCatalog, applyDiscovery, discoveryOptions } = require('../cloudfunctions/catalog-read/catalog-core');

test('published work candidates keep author ownership and the last service association without reading drafts', async () => {
  const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const db = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: process.env.PAYMENT_TEST_MYSQL_PASSWORD || '' });
  const database = `catalog_publication_test_${crypto.randomBytes(8).toString('hex')}`;
  try {
    await db.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.query(`USE \`${database}\``);
    for (const name of ['0001_identity_core.sql', '0005_provider_catalog_publications.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '../database/mysql', name), 'utf8');
      for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').filter(s => s.trim())) await db.query(statement);
    }
    const accounts = ['author_a', 'author_b', 'suspended', 'closed', 'empty', 'malformed', 'unpublished'].map(id => ({ id, uid: id, nickname: id, status: id === 'suspended' ? 'SUSPENDED' : id === 'closed' ? 'CLOSED' : 'ACTIVE' }));
    for (const a of accounts) await db.execute('INSERT INTO accounts (id,uid,nickname,status,created_at,updated_at) VALUES (?,?,?,?,1,1)', [a.id,a.uid,a.nickname,a.status]);
    const works = ['shared', 'SHARED', 'unlinked'].map((id, i) => ({ id, priceFen: i * 100, referenceCount: 0, imageAssetIds: [] }));
    const services = [{ id: 'first', priceFen: 100, workIds: ['shared', 'SHARED'] }, { id: 'last', priceFen: 200, workIds: ['shared', 'shared'] }];
    const publications = [];
    for (const a of accounts.filter(a => a.id !== 'unpublished')) {
      const payload = a.id === 'malformed' ? { services: [], works } : { profile: { career: a.id === 'author_b' ? '化妆' : '摄影', cityCode: '310000' }, services, works: a.id === 'empty' ? [] : works };
      await db.execute('INSERT INTO provider_catalog_publications (provider_id,payload,draft_version,publication_version,published_at,updated_at) VALUES (?,?,1,2,1000,1000)', [a.id, JSON.stringify(payload)]);
      publications.push({ provider_id: a.id, payload, draft_version: 1, publication_version: 2, published_at: 1000 });
    }
    const query = publishedWorkCandidatesQuery();
    const [rows] = await db.execute(query.sql, query.values);
    const expectedDb = { from(table) {
      const result = { data: table === 'provider_catalog_publications' ? publications : table === 'accounts' ? accounts.filter(a => a.status === 'ACTIVE') : [] };
      const q = { select: () => q, in: () => q, eq: () => q, then: (yes,no) => Promise.resolve(result).then(yes,no) }; return q;
    } };
    const old = await loadPublicationCatalog(expectedDb);
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map(row => [row.provider_id, row.work_payload.id, row.service_payload?.id || null]),
      old.works.map(work => [work.providerId, work.id, work.serviceId]));
    assert.ok(rows.every(row => row.publication_version === 2));
    assert.equal(rows.filter(row => row.work_payload.id === 'shared').length, 2);
    const cases = [{}, { career: '摄影' }, { career: '化妆' }, { career: "' OR 1=1 --" },
      { priceMinFen: 0, priceMaxFen: 0 }, { priceMinFen: 100, priceMaxFen: 100 },
      { priceMinFen: 1, priceMaxFen: 99 }, { priceMinFen: 200 }, { priceMaxFen: 100 },
      { career: '摄影', priceMinFen: 100 }];
    const tuples = providers => providers.flatMap(p => p.works.map(w => [p.id,w.id,w.serviceId])).sort();
    assert.equal(tuples(applyDiscovery(old, discoveryOptions({ mode: 'works', cityCode: '310000' }))).length, 4);
    for (const filters of cases) {
      const event = { mode: 'works', cityCode: '310000', ...filters };
      const filtered = publishedWorkCandidatesQuery(event);
      const [candidates] = await db.execute(filtered.sql, filtered.values);
      if (filters.career === '摄影') assert.ok(candidates.every(r => r.provider_id === 'author_a'));
      if (filters.career === '化妆') assert.ok(candidates.every(r => r.provider_id === 'author_b'));
      if (filters.career === "' OR 1=1 --") assert.equal(candidates.length, 0);
      // Remaining location/tag/date filters still run in the existing algorithm; no SQL LIMIT yet.
      const selected = new Set(candidates.map(r => JSON.stringify([r.provider_id, r.work_payload.id])));
      const reduced = { ...old, providers: old.providers.map(p => ({ ...p, works: p.works.filter(w => selected.has(JSON.stringify([p.id,w.id]))) })) };
      assert.deepEqual(tuples(applyDiscovery(reduced, discoveryOptions(event))), tuples(applyDiscovery(old, discoveryOptions(event))), JSON.stringify(filters));
      assert.ok(candidates.every(r => filters.priceMinFen == null || r.work_payload.priceFen >= filters.priceMinFen));
      assert.ok(candidates.every(r => filters.priceMaxFen == null || r.work_payload.priceFen <= filters.priceMaxFen));
    }
    assert.throws(() => publishedWorkCandidatesQuery({ mode: 'people', cityCode: '310000' }), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => publishedWorkCandidatesQuery({ mode: 'works', cityCode: '310000', priceMinFen: 2, priceMaxFen: 1 }), { code: 'INVALID_ARGUMENT' });
    const author = publications.find(p => p.provider_id === 'author_a');
    const locationCases = [
      {}, { serviceMode: 'ONSITE', serviceAreas: [{ cityCode: '110000' }] },
      { serviceMode: 'ONLINE' }, { serviceMode: 'BOTH' },
      { serviceMode: 'onsite' }, { serviceMode: 'ONSITE ' },
      { serviceMode: null }, { serviceMode: false }, { serviceMode: 0 }, { serviceMode: '' },
      { serviceMode: 'false' }, { serviceMode: '0' },
      { serviceAreas: [{ cityCode: 110000 }, { cityCode: '110000 ' }] }
    ];
    for (const service of locationCases) {
      // The first association is online; a later onsite service must still win.
      author.payload.services = [{ ...services[0], serviceMode: 'ONLINE' }, { ...services[1], ...service }];
      await db.execute('UPDATE provider_catalog_publications SET payload = ? WHERE provider_id = ?', [JSON.stringify(author.payload), author.provider_id]);
      const catalog = await loadPublicationCatalog(expectedDb);
      for (const cityCode of ['310000', '110000', '440100']) {
        const event = { mode: 'works', cityCode };
        const scoped = publishedWorkCandidatesQuery(event);
        const [actual] = await db.execute(scoped.sql, scoped.values);
        assert.deepEqual(actual.map(r => [r.provider_id,r.work_payload.id,r.service_payload.id]).sort(),
          tuples(applyDiscovery(catalog, discoveryOptions(event))), JSON.stringify({service, cityCode}));
      }
    }
    // Invalid snapshots still require the existing publication validator after extraction.
    author.payload.services[1].serviceAreas = { cityCode: '110000' };
    await db.execute('UPDATE provider_catalog_publications SET payload = ? WHERE provider_id = ?', [JSON.stringify(author.payload), author.provider_id]);
    const invalidCatalog = await loadPublicationCatalog(expectedDb);
    assert.equal(invalidCatalog.providers.some(p => p.id === author.provider_id), false);
    await db.execute('DELETE FROM provider_catalog_publications WHERE provider_id = ?', ['author_a']);
    const [after] = await db.execute(query.sql, query.values);
    assert.equal(after.length, 3); assert.ok(after.every(row => row.provider_id === 'author_b'));
    await db.execute("UPDATE accounts SET status = 'SUSPENDED' WHERE id = ?", ['author_b']);
    const [suspended] = await db.execute(query.sql, query.values);
    assert.equal(suspended.length, 0);
  } finally {
    await db.query(`DROP DATABASE IF EXISTS \`${database}\``); await db.end();
  }
});
