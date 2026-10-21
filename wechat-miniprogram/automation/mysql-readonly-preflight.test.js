const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { inspectDatabase, REQUIRED_TABLES, REQUIRED_COLUMNS, REQUIRED_INDEXES } = require('./mysql-readonly-preflight');
const config = { host: 'test.invalid', database: 'business', user: 'reader', password: 'fixture-only' };
function fixture(overrides = {}) {
  const state = { statements: [], closed: false };
  const createConnection = async options => {
    state.options = options;
    return {
      async query(sql) {
        state.statements.push(sql);
        if (overrides.error) throw overrides.error;
        if (sql.startsWith('SHOW')) return [overrides.tls || [
          { Variable_name: 'Ssl_cipher', Value: 'TLS_AES_256_GCM_SHA384' }, { Variable_name: 'Ssl_version', Value: 'TLSv1.3' }]];
        return [[{ databaseName: overrides.database || 'business', serverVersion: '8.4.11' }]];
      },
      async execute(sql, parameters) {
        state.statements.push(sql); state.parameters = parameters;
        if (sql.includes('information_schema.COLUMNS')) return [overrides.columns || Object.entries(REQUIRED_COLUMNS).flatMap(([tableName,fields]) =>
          Object.entries(fields).map(([columnName,columnType])=>({tableName,columnName,columnType})))];
        if (sql.includes('information_schema.STATISTICS')) return [overrides.indexes || Object.entries(REQUIRED_INDEXES).flatMap(([tableName,rules])=>
          rules.flatMap((rule,n)=>rule.columns.map((columnName,i)=>({tableName,indexName:`idx_${n}`,nonUnique:rule.unique?0:1,sequence:i+1,columnName,prefixLength:null}))))];
        return [overrides.tables || REQUIRED_TABLES.map(tableName => ({ tableName, engine: 'InnoDB' }))];
      },
      async end() { state.closed = true; }
    };
  };
  return { state, createConnection };
}

test('preflight reads metadata only and keeps strict TLS even when input asks to disable it', async () => {
  const f = fixture();
  const result = await inspectDatabase({ ...config, ssl: false, rejectUnauthorized: false }, f.createConnection);
  assert.equal(result.ok, true);
  assert.equal(f.state.options.ssl.rejectUnauthorized, true);
  assert.equal(f.state.options.ssl.verifyIdentity, true);
  assert.equal(f.state.options.ssl.minVersion, 'TLSv1.2');
  assert.equal(f.state.options.multipleStatements, false);
  assert.deepEqual(f.state.parameters, ['business', ...Object.keys(REQUIRED_COLUMNS)]);
  assert.ok(f.state.statements.every(sql => /^(SELECT|SHOW) /.test(sql)));
  assert.equal(f.state.closed, true);
  assert.doesNotMatch(JSON.stringify(result), /fixture-only|test.invalid|reader/);
});

test('invalid or absent configuration cannot connect', async () => {
  for (const value of [null, {}, { ...config, port: 0 }, { ...config, port: 65536 }, { ...config, ca: '' }]) {
    const f = fixture();
    await assert.rejects(inspectDatabase(value, f.createConnection), { code: 'CONFIG_INVALID' });
    assert.equal(f.state.options, undefined);
  }
});

test('missing cipher and obsolete TLS cannot pass and always close the connection', async () => {
  for (const tls of [[], [{ Variable_name: 'Ssl_cipher', Value: 'cipher' }, { Variable_name: 'Ssl_version', Value: 'TLSv1' }]]) {
    const f = fixture({ tls });
    await assert.rejects(inspectDatabase(config, f.createConnection), { code: 'TLS_NOT_VERIFIED' });
    assert.equal(f.state.closed, true); assert.equal(f.state.statements.length, 1);
  }
});

test('wrong database stops before table inspection', async () => {
  const f = fixture({ database: 'wrong' });
  await assert.rejects(inspectDatabase(config, f.createConnection), { code: 'DATABASE_MISMATCH' });
  assert.equal(f.state.parameters, undefined); assert.equal(f.state.closed, true);
});

test('missing migrations or nontransactional tables produce an explicit incomplete result', async () => {
  const tables = REQUIRED_TABLES.filter(name => name !== 'order_settlement_tasks').map(tableName => ({ tableName, engine: tableName === 'order_payments' ? 'MyISAM' : 'InnoDB' }));
  const f = fixture({ tables });
  const result = await inspectDatabase(config, f.createConnection);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingTables, ['order_settlement_tasks']);
  assert.deepEqual(result.nonTransactionalTables, ['order_payments']);
  assert.equal(f.state.closed, true);
});

test('database read failure still releases the connection', async () => {
  const f = fixture({ error: new Error('read failed') });
  await assert.rejects(inspectDatabase(config, f.createConnection), /read failed/);
  assert.equal(f.state.closed, true);
});

test('tables alone cannot pass when prepay migrations or uniqueness indexes are missing', async () => {
  const f=fixture({columns:[],indexes:[]});
  const result=await inspectDatabase(config,f.createConnection);
  assert.equal(result.ok,false);assert.equal(result.missingTables.length,0);
  assert.ok(result.columnIssues.some(item=>item.column==='prepay_recovery_started_at'));
  assert.ok(result.indexIssues.some(item=>item.unique && item.columns.includes('transaction_id')));
  assert.equal(f.state.closed,true);
});

test('CLI rejects malformed secret configuration without printing its contents', () => {
  const result = spawnSync(process.execPath, [require.resolve('./mysql-readonly-preflight')], {
    env: { ...process.env, PAYMENT_MYSQL_CONFIG: 'private-secret-not-json' }, encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).code, 'CONFIG_INVALID');
  assert.doesNotMatch(result.stderr + result.stdout, /private-secret-not-json/);
});

test('refund request and journal uniqueness cannot be replaced with ordinary indexes', async () => {
  const indexes = Object.entries(REQUIRED_INDEXES).flatMap(([tableName, rules]) => rules.flatMap((rule, n) =>
    rule.columns.map((columnName, i) => ({ tableName, indexName: `idx_${n}`, sequence: i + 1, columnName,
      nonUnique: ['order_refunds','fund_journals','fund_postings'].includes(tableName) ? 1 : rule.unique ? 0 : 1, prefixLength: null }))));
  const result = await inspectDatabase(config, fixture({ indexes }).createConnection);
  assert.equal(result.ok, false);
  assert.ok(result.indexIssues.some(row => row.table === 'order_refunds' && row.columns.join(',') === 'payment_id,request_key'));
  assert.ok(result.indexIssues.some(row => row.table === 'fund_journals' && row.columns[0] === 'refund_id'));
  assert.ok(result.indexIssues.some(row => row.table === 'fund_postings' && row.columns.join(',') === 'journal_id,account'));
});

test('missing withdrawal sources and nonunique bank receipts cannot pass a release preflight', async () => {
  const tables = REQUIRED_TABLES.filter(name => name !== 'withdrawal_sources').map(tableName => ({ tableName, engine: 'InnoDB' }));
  const columns = Object.entries(REQUIRED_COLUMNS).filter(([table]) => table !== 'withdrawal_sources').flatMap(([tableName, fields]) =>
    Object.entries(fields).map(([columnName, columnType]) => ({ tableName, columnName, columnType })));
  const indexes = Object.entries(REQUIRED_INDEXES).flatMap(([tableName, rules]) => rules.flatMap((rule, n) =>
    rule.columns.map((columnName, i) => ({ tableName, indexName: `idx_${n}`, sequence: i + 1, columnName,
      nonUnique: ['withdrawal_sources', 'withdrawal_receipt_events', 'bank_settlement_sources'].includes(tableName) ? 1 : rule.unique ? 0 : 1,
      prefixLength: null }))));
  const result = await inspectDatabase(config, fixture({ tables, columns, indexes }).createConnection);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingTables, ['withdrawal_sources']);
  assert.ok(result.columnIssues.some(r => r.table === 'withdrawal_sources' && r.column === 'amount_fen'));
  for (const table of ['withdrawal_sources', 'withdrawal_receipt_events', 'bank_settlement_sources']) {
    assert.ok(result.indexIssues.some(r => r.table === table && r.unique));
  }
});
