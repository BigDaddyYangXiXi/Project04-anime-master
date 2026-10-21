const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('../cloudfunctions/payment-api/node_modules/mysql2/promise');
const { catalogMetricsQuery, applyCatalogMetrics, catalogLocksQuery } = require('../scripts/catalog-metrics-query');
const { enrichCatalogMetrics, applyDiscovery, discoveryOptions } = require('../cloudfunctions/catalog-read/catalog-core');

test('local MySQL aggregates public metrics without returning private order payloads', async () => {
  const port = Number(process.env.PAYMENT_TEST_MYSQL_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Explicit local port required');
  const db = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password: process.env.PAYMENT_TEST_MYSQL_PASSWORD || '' });
  const database = `catalog_metrics_test_${crypto.randomBytes(8).toString('hex')}`;
  try {
    await db.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.query(`USE \`${database}\``);
    for (const file of ['0001_identity_core.sql', '0006_order_aggregates.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '../database/mysql', file), 'utf8');
      for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').filter(s => s.trim())) await db.query(statement);
    }
    for (const id of ['buyer', 'author_a', 'author_b', 'unrelated']) await db.execute(
      'INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES (?,?,?,1,1)', [id, id, id]);
    const orders = [];
    for (const [provider, entries] of [
      ['author_a', [
        { rating: 5, contactFirstCopiedAt: 61000, buyerAgreementConfirmedAt: 2, referenceWorkId: 'same' },
        { rating: 4, contactFirstCopiedAt: 121000, buyerAgreementConfirmedAt: 3, referenceWorkId: 'same' },
        { rating: '5', contactFirstCopiedAt: '61000', buyerAgreementConfirmedAt: 0, referenceWorkId: 'same' },
        { rating: 4.00000001, contactFirstCopiedAt: 1000.00001 },
        { rating: 0, contactFirstCopiedAt: 999 },
        { rating: 6, contactFirstCopiedAt: 9007199254740992 },
        { rating: null, contactFirstCopiedAt: null },
        { rating: true, contactFirstCopiedAt: true },
        { buyerAgreementConfirmedAt: false, referenceWorkId: 'same' },
        { buyerAgreementConfirmedAt: '', referenceWorkId: 'same' },
        { buyerAgreementConfirmedAt: 1, referenceWorkId: '__proto__' },
        { rating: 1e308, contactFirstCopiedAt: 1e308 },
        { rating: [], contactFirstCopiedAt: {} },
        { buyerAgreementConfirmedAt: '0', referenceWorkId: 'same' },
        { buyerAgreementConfirmedAt: [], referenceWorkId: 'same' },
        { buyerAgreementConfirmedAt: 1, referenceWorkId: 'same ' },
        { buyerAgreementConfirmedAt: 1, referenceWorkId: 'SAME' },
        { buyerAgreementConfirmedAt: ' ', referenceWorkId: 'same' },
        { buyerAgreementConfirmedAt: 1, referenceWorkId: ' ' },
        { buyerAgreementConfirmedAt: 1, referenceWorkId: 'é' },
        { buyerAgreementConfirmedAt: 1, referenceWorkId: 'e\u0301' },
        ...[17, '17', true, 'true', ['same'], [], {}, '[object Object]', [1, null, ['same']], 1e30, 0, false, null, ''].map(referenceWorkId => ({ buyerAgreementConfirmedAt: 1, referenceWorkId })),
        null, false, 0, '', true, 1, 'text', [], {}]],
      ['author_b', [{ rating: 3, buyerAgreementConfirmedAt: 1, referenceWorkId: 'same' }]],
      ['unrelated', [{ rating: 1, buyerAgreementConfirmedAt: 1, referenceWorkId: 'same' }]]
    ]) for (const value of entries) orders.push({ provider_id: provider, stage: 'COMPLETED', created_at: 1000,
      payload: { public: value, private: { contact: 'MUST_NOT_RETURN', referenceAsset: 'private_asset' } } });
    orders.push({ provider_id: 'author_a', stage: 'REQUESTED', created_at: 1000,
      payload: { public: { rating: 5, contactFirstCopiedAt: 181000, buyerAgreementConfirmedAt: 1, referenceWorkId: 'same' } } });
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      await db.execute('INSERT INTO order_aggregates (id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,created_at,updated_at) VALUES (?,\'buyer\',?,?,?, ?,?,1000,1000)',
        [`o_${i}`, o.provider_id, `r_${i}`, '0'.repeat(64), o.stage, JSON.stringify(o.payload)]);
    }
    const input = catalogMetricsQuery(['author_a', 'author_b']);
    const [rows] = await db.execute(input.sql, input.values);
    assert.ok(!JSON.stringify(rows).includes('MUST_NOT_RETURN'));
    assert.ok(rows.every(row => ['author_a', 'author_b'].includes(row.provider_id)));
    const catalog = { providers: ['author_a', 'author_b'].map(id => ({ id, works: ['same', 'same ', 'SAME', ' ', 'é', 'e\u0301', '__proto__', '17', 'true', '', '[object Object]', '1,,same', '1e+30', '0', 'false', 'null'].map(id => ({ id, referenceCount: 0 })) })) };
    const expected = enrichCatalogMetrics(catalog, orders).providers;
    const sourceBefore = structuredClone(catalog);
    assert.deepEqual(applyCatalogMetrics(catalog, rows), enrichCatalogMetrics(catalog, orders));
    assert.deepEqual(catalog, sourceBefore, 'aggregation must not mutate cached publication snapshots');
    const empty = { providers: [{ id: 'no_orders', works: [{ id: 'same', referenceCount: 7 }] }] };
    assert.deepEqual(applyCatalogMetrics(empty, rows), enrichCatalogMetrics(empty, []));
    for (const provider of expected) {
      const own = rows.filter(row => row.provider_id === provider.id);
      const sum = key => own.reduce((value, row) => value + Number(row[key]), 0);
      assert.equal(sum('completed_orders'), provider.orders);
      assert.equal(sum('rating_count'), provider.reviewCount);
      assert.equal(Math.round(sum('rating_total') / sum('rating_count') * 10) / 10, provider.rating);
      assert.equal(sum('response_count'), provider.responseSampleCount);
      assert.equal(sum('response_count') ? Math.round(sum('response_total_ms') / sum('response_count') / 60000) : null, provider.averageResponseMinutes);
    }
    assert.equal(catalogMetricsQuery([]), null);
    assert.throws(() => catalogMetricsQuery(["x' OR 1=1"]));
    assert.throws(() => catalogMetricsQuery(Array(201).fill('author_a')));
    assert.equal(catalogLocksQuery([]), null);
    assert.throws(() => catalogLocksQuery(["x' OR 1=1"]));
    const lockCatalog = { providers: ['author_a', 'author_b'].map(id => ({ id, career: '摄影', cityCode: '310000',
      services: [{ id: 'service', name: '摄影', priceFen: 100, serviceMode: 'ONSITE' }], works: [], publishedAt: 1 })) };
    const midnight = Date.parse('2026-10-07T00:00:00+08:00');
    assert.equal(applyDiscovery(lockCatalog, discoveryOptions({ mode: 'people', cityCode: '310000', career: '摄影', date: '2026-10-06' }), [], []).length, 2);
    const segments = [{ startsAt: midnight - 3600000, endsAt: midnight }];
    for (const [stage, publicValue] of [
      ['IN_PRODUCTION', { timeSegments: segments }],
      ['COMPLETED', { timeSegments: [{ startsAt: midnight, endsAt: midnight + 86400000 }] }],
      ['NDA_BUYER_PENDING', { timeSegments: segments, ndaFlowVersion: 2, communicationDone: false }],
      ['NDA_PROVIDER_PENDING', { timeSegments: segments, ndaFlowVersion: 2, communicationDone: true }],
      ['NDA_BUYER_PENDING', { timeSegments: segments, ndaFlowVersion: '2', communicationDone: false }],
      ['REQUESTED', { timeSegments: segments }],
      ['DECLINED', { timeSegments: segments }],
      ['DELIVERY_PENDING', { timeSegments: [{ startsAt: midnight, endsAt: midnight }] }],
      ['REVISION_REQUESTED', { timeSegments: [] }],
      ['BUYER_FINAL_CONFIRM', null]
    ]) {
      await db.query('DELETE FROM order_aggregates');
      const payload = { public: publicValue, private: { contact: 'MUST_NOT_RETURN' }, unrelated: 'MUST_NOT_RETURN' };
      await db.execute("INSERT INTO order_aggregates (id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,created_at,updated_at) VALUES ('lock_order','buyer','author_a','lock_request',?,?,?,1000,1000)", ['0'.repeat(64), stage, JSON.stringify(payload)]);
      const query = catalogLocksQuery(['author_a', 'author_b']);
      const [lockRows] = await db.execute(query.sql, query.values);
      assert.ok(!JSON.stringify(lockRows).includes('MUST_NOT_RETURN'));
      for (const date of ['2026-10-06', '2026-10-07', '2026-10-08']) {
        const options = discoveryOptions({ mode: 'people', cityCode: '310000', career: '摄影', date });
        assert.deepEqual(applyDiscovery(lockCatalog, options, [], lockRows),
          applyDiscovery(lockCatalog, options, [], [{ provider_id: 'author_a', stage, payload }]), `${stage}/${date}`);
        if (stage === 'IN_PRODUCTION') assert.equal(applyDiscovery(lockCatalog, options, [], lockRows).length, date === '2026-10-06' ? 1 : 2);
      }
    }
    await db.query('DELETE FROM order_aggregates');
    const providerIds = Array.from({ length: 60 }, (_, i) => `scale_${i}`);
    for (const id of providerIds) await db.execute('INSERT INTO accounts (id,uid,nickname,created_at,updated_at) VALUES (?,?,?,1,1)', [id, id, id]);
    const payload = JSON.stringify({ public: { rating: 5, buyerAgreementConfirmedAt: 1, referenceWorkId: 'same', contactFirstCopiedAt: 61000 }, private: { contact: 'MUST_NOT_RETURN' } });
    for (let start = 0; start < 6000; start += 500) {
      const values = Array.from({ length: 500 }, (_, offset) => { const i = start + offset; return [`scale_order_${i}`, 'buyer', providerIds[Math.floor(i / 100)], `scale_request_${i}`, '0'.repeat(64), 'COMPLETED', payload, 1000, 1000]; });
      await db.query('INSERT INTO order_aggregates (id,buyer_id,provider_id,request_idempotency_key,request_hash,stage,payload,created_at,updated_at) VALUES ?', [values]);
    }
    const scaleQuery = catalogMetricsQuery(providerIds);
    const [aggregated] = await db.execute(scaleQuery.sql, scaleQuery.values);
    assert.equal(aggregated.length, 60);
    assert.ok(aggregated.every(row => Number(row.completed_orders) === 100 && Number(row.reference_count) === 100));
    const scaleCatalog = { providers: providerIds.map(id => ({ id, works: [{ id: 'same', referenceCount: 0 }] })) };
    const scaleOrders = providerIds.flatMap(provider_id => Array.from({ length: 100 }, () => ({ provider_id, stage: 'COMPLETED', created_at: 1000, payload: JSON.parse(payload) })));
    assert.deepEqual(applyCatalogMetrics(scaleCatalog, aggregated), enrichCatalogMetrics(scaleCatalog, scaleOrders));
    const [plan] = await db.execute(`EXPLAIN ANALYZE ${scaleQuery.sql}`, scaleQuery.values);
    fs.writeFileSync(path.join(__dirname, '../.artifacts/catalog-metrics-sql-scale-20261003.json'), JSON.stringify({
      localMysql: true, fixture: true, orderCount: 6000, providerCount: 60, aggregateRows: aggregated.length,
      returnedColumns: Object.keys(aggregated[0]), explainAnalyze: plan,
      note: 'Local single query evidence; not production latency, network bytes, P95 or database pagination acceptance.'
    }, null, 2));
  } finally {
    await db.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await db.end();
  }
});
